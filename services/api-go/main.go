package main

import (
        "crypto/rand"
        "database/sql"
        "encoding/hex"
        "encoding/json"
        "fmt"
        "io"
        "log"
        "net/http"
        "os"
        "path/filepath"
        "strings"
        "sync"
        "time"

        _ "modernc.org/sqlite"
)

var (
        db       *sql.DB
        mediaDir = "/opt/montage-webapp/media"
        mu       sync.Mutex
)

type User struct {
        ID         string `json:"id"`
        TelegramID string `json:"telegramId"`
        Username   string `json:"username"`
        FirstName  string `json:"firstName"`
        Role       string `json:"role"`
        DailyUsed  int    `json:"dailyUsed"`
        DailyLimit int    `json:"dailyLimit"`
}

type Job struct {
        ID            string  `json:"id"`
        UserID        string  `json:"userId"`
        Type          string  `json:"type"`
        Status        string  `json:"status"`
        StageKey      string  `json:"stageKey"`
        StageLabel    string  `json:"stageLabel"`
        Progress      int     `json:"progress"`
        QueuePosition int     `json:"queuePosition"`
        SourceType    string  `json:"sourceType"`
        SourceName    *string `json:"sourceName,omitempty"`
        SourceURL     *string `json:"sourceUrl,omitempty"`
        FilePath      *string `json:"filePath,omitempty"`
        Params        string  `json:"params"`
        ResultURL     *string `json:"resultUrl,omitempty"`
        ThumbURL      *string `json:"thumbUrl,omitempty"`
        Error         *string `json:"error,omitempty"`
        RamMb         int     `json:"ramMb"`
        CreatedAt     string  `json:"createdAt"`
}

type ShowcaseItem struct {
        ID        string  `json:"id"`
        Title     string  `json:"title"`
        Subtitle  string  `json:"subtitle"`
        Kind      string  `json:"kind"`
        ThumbURL  string  `json:"thumbUrl"`
        VideoURL  string  `json:"videoUrl"`
        Duration  string  `json:"duration"`
        Featured  bool    `json:"featured"`
        Views     int     `json:"views"`
        OrderNum  int     `json:"orderNum"`
}

type LogEvent struct {
        ID        string `json:"id"`
        JobID     string `json:"jobId"`
        Level     string `json:"level"`
        Message   string `json:"message"`
        CreatedAt string `json:"createdAt"`
}

func genID(prefix string) string {
        b := make([]byte, 6)
        _, _ = rand.Read(b)
        return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b))
}

func initDB(dbPath string) error {
        dir := filepath.Dir(dbPath)
        _ = os.MkdirAll(dir, 0755)

        var err error
        db, err = sql.Open("sqlite", dbPath)
        if err != nil {
                return err
        }

        schema := `
        CREATE TABLE IF NOT EXISTS User (
                id TEXT PRIMARY KEY,
                telegramId TEXT UNIQUE,
                username TEXT,
                firstName TEXT,
                role TEXT DEFAULT 'user',
                isBlocked INTEGER DEFAULT 0,
                dailyUsed INTEGER DEFAULT 0,
                dailyLimit INTEGER DEFAULT 3,
                usageResetAt TEXT,
                createdAt TEXT
        );

        CREATE TABLE IF NOT EXISTS Job (
                id TEXT PRIMARY KEY,
                userId TEXT,
                type TEXT,
                status TEXT,
                stageKey TEXT,
                stageLabel TEXT,
                progress INTEGER DEFAULT 0,
                queuePosition INTEGER DEFAULT 0,
                sourceType TEXT,
                sourceName TEXT,
                sourceUrl TEXT,
                filePath TEXT,
                params TEXT,
                resultUrl TEXT,
                thumbUrl TEXT,
                error TEXT,
                ramMb INTEGER DEFAULT 0,
                notified INTEGER DEFAULT 0,
                startedAt TEXT,
                completedAt TEXT,
                createdAt TEXT
        );

        CREATE TABLE IF NOT EXISTS ShowcaseItem (
                id TEXT PRIMARY KEY,
                title TEXT,
                subtitle TEXT,
                kind TEXT,
                thumbUrl TEXT,
                videoUrl TEXT,
                duration TEXT,
                featured INTEGER DEFAULT 0,
                views INTEGER DEFAULT 0,
                orderNum INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS Event (
                id TEXT PRIMARY KEY,
                jobId TEXT,
                level TEXT,
                message TEXT,
                createdAt TEXT
        );
        `
        _, err = db.Exec(schema)
        if err != nil {
                return err
        }

        // Дефолтный админ
        now := time.Now().UTC().Format(time.RFC3339)
        _, _ = db.Exec(`
                INSERT OR IGNORE INTO User (id, telegramId, username, firstName, role, dailyUsed, dailyLimit, createdAt)
                VALUES ('u_admin', '8519049699', 'admin', 'Сергей', 'admin', 0, 999, ?)
        `, now)

        // Дефолтная витрина (Реальные смонтированные работы по суду, КСУ и Domdara)
        _, _ = db.Exec(`
                INSERT OR IGNORE INTO ShowcaseItem (id, title, subtitle, kind, thumbUrl, videoUrl, duration, featured, views, orderNum)
                VALUES 
                ('sc_ksu', 'КСУ: Карантинні обмеження прав незаконні', 'Сергій Велічко · Рішення КСУ від 29.09.2026', 'short', '/showcase/ksu.jpg', 'https://youtu.be/OU03THwqGeM', '01:38', 1, 15900, 1),
                ('sc_makulatura', 'Суддя відмовилась приймати макулатуру прокурора!', 'Суд за ст. 114-1 КК України · Запоріжжя', 'short', '/showcase/makulatura.jpg', '/demo/makulatura.mp4', '00:49', 1, 12400, 2),
                ('sc_dates', 'Акт вручили ДО того, як затвердили?! Ляп прокуратури', 'Порушення ст. 290 КПК · Відкриття матеріалів', 'short', '/showcase/dates.jpg', '/demo/dates.mp4', '00:48', 1, 9800, 3),
                ('sc_raport', 'Відео до рапорту?! Адвокат розніс прокуратуру по ст. 104 КПК', 'Правовий розбір судового засідання', 'short', '/showcase/raport.jpg', '/demo/raport.mp4', '00:54', 0, 8700, 4),
                ('sc_ekspertyzy', 'Експертизи після закриття слідства?! Прокурор виправдовується!', 'Порушення строків досудового розслідування', 'short', '/showcase/ekspertyzy.jpg', '/demo/ekspertyzy.mp4', '00:46', 0, 11200, 5),
                ('sc_velychko_court', 'Сергій Велічко в суді: Строки слідства закінчилися!', 'Виступ у суді за ст. 114-1 КК України', 'short', '/showcase/velychko_court.jpg', '/demo/velychko_court.mp4', '00:49', 1, 16800, 6),
                ('sc_domdara', 'Суд ухвалив: без даних у реєстрі представник НЕ ДІЙСНИЙ!', 'Прецедент Верховного Суду України · domdara.org', 'short', '/showcase/domdara_news.jpg', '/demo/domdara_court.mp4', '00:42', 0, 7600, 7),
                ('sc_long_court', 'Повне засідання суду за ст. 114-1: клопотання та строки', 'Повний запис судового засідання 16:9 із главами та таймкодами', 'long', '/showcase/court_long.jpg', 'https://youtu.be/OU03THwqGeM', '18:24', 1, 22700, 8)
        `)

        return nil
}

func jsonResponse(w http.ResponseWriter, data any, status int) {
        w.Header().Set("Content-Type", "application/json")
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.WriteHeader(status)
        _ = json.NewEncoder(w).Encode(data)
}

func logEvent(jobID, level, msg string) {
        now := time.Now().UTC().Format(time.RFC3339)
        _, _ = db.Exec("INSERT INTO Event (id, jobId, level, message, createdAt) VALUES (?, ?, ?, ?, ?)", genID("ev"), jobID, level, msg, now)
}

// /api/auth
func handleAuth(w http.ResponseWriter, r *http.Request) {
        u := User{
                ID:         "u_admin",
                TelegramID: "8519049699",
                Username:   "admin",
                FirstName:  "Сергей",
                Role:       "admin",
                DailyUsed:  0,
                DailyLimit: 999,
        }
        jsonResponse(w, map[string]any{"user": u}, http.StatusOK)
}

// /api/showcase
func handleShowcase(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query("SELECT id, title, subtitle, kind, thumbUrl, videoUrl, duration, featured, views, orderNum FROM ShowcaseItem ORDER BY orderNum ASC")
        if err != nil {
                jsonResponse(w, map[string]any{"error": err.Error()}, http.StatusInternalServerError)
                return
        }
        defer rows.Close()

        var items []ShowcaseItem
        for rows.Next() {
                var it ShowcaseItem
                var feat int
                _ = rows.Scan(&it.ID, &it.Title, &it.Subtitle, &it.Kind, &it.ThumbURL, &it.VideoURL, &it.Duration, &feat, &it.Views, &it.OrderNum)
                it.Featured = (feat == 1)
                items = append(items, it)
        }
        jsonResponse(w, map[string]any{"items": items}, http.StatusOK)
}

// /api/jobs
func handleJobs(w http.ResponseWriter, r *http.Request) {
        if r.Method == http.MethodGet {
                rows, err := db.Query("SELECT id, userId, type, status, stageKey, stageLabel, progress, queuePosition, sourceType, sourceName, sourceUrl, filePath, params, resultUrl, thumbUrl, error, ramMb, createdAt FROM Job ORDER BY createdAt DESC LIMIT 30")
                if err != nil {
                        jsonResponse(w, map[string]any{"error": err.Error()}, http.StatusInternalServerError)
                        return
                }
                defer rows.Close()

                var jobs []Job
                for rows.Next() {
                        var j Job
                        _ = rows.Scan(&j.ID, &j.UserID, &j.Type, &j.Status, &j.StageKey, &j.StageLabel, &j.Progress, &j.QueuePosition, &j.SourceType, &j.SourceName, &j.SourceURL, &j.FilePath, &j.Params, &j.ResultURL, &j.ThumbURL, &j.Error, &j.RamMb, &j.CreatedAt)
                        jobs = append(jobs, j)
                }
                jsonResponse(w, map[string]any{"jobs": jobs}, http.StatusOK)
                return
        }

        if r.Method == http.MethodPost {
                // Парсим multipart или JSON
                var jType, sType, sURL, sName, fPath string
                paramsMap := map[string]any{
                        "title":       "Монтаж из Mini App",
                        "speech_lang": "uk",
                        "sub_lang":    "ru",
                }

                // P0-фикс (отзыв владельца job_372d0282ed65): раньше params из Mini App
                // дропались — таймкоды ±2с, титулы хуков и target_duration не доходили
                // до воркера. Теперь клиентские params мержатся поверх дефолтов.
                mergeParams := func(raw string) {
                        if raw == "" {
                                return
                        }
                        var client map[string]any
                        if err := json.Unmarshal([]byte(raw), &client); err != nil || client == nil {
                                return
                        }
                        for k, v := range client {
                                paramsMap[k] = v
                        }
                }

                if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
                        _ = r.ParseMultipartForm(500 << 20) // 500 MB
                        jType = r.FormValue("type")
                        if jType == "" {
                                jType = "short"
                        }
                        sType = r.FormValue("sourceType")
                        sURL = r.FormValue("sourceUrl")
                        if sn := r.FormValue("sourceName"); sn != "" {
                                sName = sn
                        }
                        mergeParams(r.FormValue("params"))

                        file, header, err := r.FormFile("file")
                        if err == nil && file != nil {
                                defer file.Close()
                                if sName == "" {
                                        sName = header.Filename
                                }
                                fName := fmt.Sprintf("%s_%s", genID("upload"), header.Filename)
                                fPath = filepath.Join(mediaDir, "uploads", fName)
                                _ = os.MkdirAll(filepath.Dir(fPath), 0755)
                                outF, err := os.Create(fPath)
                                if err == nil {
                                        _, _ = io.Copy(outF, file)
                                        outF.Close()
                                }
                        }
                } else {
                        var body map[string]any
                        _ = json.NewDecoder(r.Body).Decode(&body)
                        if t, ok := body["type"].(string); ok {
                                jType = t
                        } else {
                                jType = "short"
                        }
                        if st, ok := body["sourceType"].(string); ok {
                                sType = st
                        }
                        if su, ok := body["sourceUrl"].(string); ok {
                                sURL = su
                        }
                        if sn, ok := body["sourceName"].(string); ok && sn != "" {
                                sName = sn
                        }
                        if pm, ok := body["params"].(map[string]any); ok {
                                for k, v := range pm {
                                        paramsMap[k] = v
                                }
                        }
                }

                jobID := genID("job")
                now := time.Now().UTC().Format(time.RFC3339)

                var qCount int
                _ = db.QueryRow("SELECT COUNT(*) FROM Job WHERE status = 'queued'").Scan(&qCount)

                pBytes, _ := json.Marshal(paramsMap)
                _, err := db.Exec(`
                        INSERT INTO Job (id, userId, type, status, stageKey, stageLabel, progress, queuePosition, sourceType, sourceName, sourceUrl, filePath, params, notified, createdAt)
                        VALUES (?, 'u_admin', ?, 'queued', 'download', 'В очереди', 0, ?, ?, ?, ?, ?, ?, 0, ?)
                `, jobID, jType, qCount+1, sType, sName, sURL, fPath, string(pBytes), now)

                if err != nil {
                        jsonResponse(w, map[string]any{"error": err.Error()}, http.StatusInternalServerError)
                        return
                }

                logEvent(jobID, "info", fmt.Sprintf("Mini App: создана задача %s (позиция #%d)", strings.ToUpper(jType), qCount+1))

                job := Job{
                        ID:            jobID,
                        UserID:        "u_admin",
                        Type:          jType,
                        Status:        "queued",
                        StageKey:      "download",
                        StageLabel:    "В очереди",
                        Progress:      0,
                        QueuePosition: qCount + 1,
                        SourceType:    sType,
                        CreatedAt:     now,
                }
                jsonResponse(w, map[string]any{"job": job}, http.StatusCreated)
                return
        }
}

// /api/jobs/{id}
func handleJobDetail(w http.ResponseWriter, r *http.Request) {
        id := strings.TrimPrefix(r.URL.Path, "/api/jobs/")
        if id == "" {
                http.NotFound(w, r)
                return
        }

        if r.Method == http.MethodDelete {
                _, _ = db.Exec("UPDATE Job SET status = 'cancelled' WHERE id = ?", id)
                logEvent(id, "warning", "Пользователь отменил задачу")
                jsonResponse(w, map[string]any{"success": true}, http.StatusOK)
                return
        }
        http.NotFound(w, r)
}

// --- Воркер API (pull модель для ноутбука 12 ГБ) ----------------------------

// GET /api/worker/next-job
func handleWorkerNext(w http.ResponseWriter, r *http.Request) {
        mu.Lock()
        defer mu.Unlock()

        // 1. Проверяем, есть ли активная задача
        var activeID string
        _ = db.QueryRow("SELECT id FROM Job WHERE status = 'processing' LIMIT 1").Scan(&activeID)
        if activeID != "" {
                jsonResponse(w, map[string]any{"status": "busy", "jobId": activeID}, http.StatusOK)
                return
        }

        // 2. Берём самую старую задачу в очереди (FIFO)
        var j Job
        err := db.QueryRow(`
                SELECT id, userId, type, status, stageKey, stageLabel, progress, queuePosition, sourceType, sourceName, sourceUrl, filePath, params, createdAt
                FROM Job
                WHERE status = 'queued'
                ORDER BY createdAt ASC LIMIT 1
        `).Scan(&j.ID, &j.UserID, &j.Type, &j.Status, &j.StageKey, &j.StageLabel, &j.Progress, &j.QueuePosition, &j.SourceType, &j.SourceName, &j.SourceURL, &j.FilePath, &j.Params, &j.CreatedAt)

        if err != nil {
                jsonResponse(w, map[string]any{"status": "idle"}, http.StatusOK)
                return
        }

        // Переводим в status = 'processing'
        now := time.Now().UTC().Format(time.RFC3339)
        _, _ = db.Exec("UPDATE Job SET status = 'processing', startedAt = ?, stageLabel = 'Рендеринг на ноутбуке', queuePosition = 0 WHERE id = ?", now, j.ID)
        logEvent(j.ID, "info", "Воркер на ноутбуке захватил задачу (FIFO слот 1/1)")

        j.Status = "processing"
        j.StageLabel = "Рендеринг на ноутбуке"
        jsonResponse(w, map[string]any{"status": "job", "job": j}, http.StatusOK)
}

// POST /api/worker/progress
func handleWorkerProgress(w http.ResponseWriter, r *http.Request) {
        var body struct {
                JobID      string `json:"jobId"`
                StageKey   string `json:"stageKey"`
                StageLabel string `json:"stageLabel"`
                Progress   int    `json:"progress"`
                RamMb      int    `json:"ramMb"`
        }
        _ = json.NewDecoder(r.Body).Decode(&body)
        if body.JobID == "" {
                jsonResponse(w, map[string]any{"error": "no jobId"}, http.StatusBadRequest)
                return
        }

        _, _ = db.Exec(`
                UPDATE Job
                SET stageKey = ?, stageLabel = ?, progress = ?, ramMb = ?
                WHERE id = ?
        `, body.StageKey, body.StageLabel, body.Progress, body.RamMb, body.JobID)

        logEvent(body.JobID, "info", fmt.Sprintf("[%d%%] %s", body.Progress, body.StageLabel))
        jsonResponse(w, map[string]any{"success": true}, http.StatusOK)
}

// POST /api/worker/complete
func handleWorkerComplete(w http.ResponseWriter, r *http.Request) {
        var body struct {
                JobID     string `json:"jobId"`
                ResultURL string `json:"resultUrl"`
                ThumbURL  string `json:"thumbUrl"`
                Error     string `json:"error"`
        }
        _ = json.NewDecoder(r.Body).Decode(&body)
        if body.JobID == "" {
                jsonResponse(w, map[string]any{"error": "no jobId"}, http.StatusBadRequest)
                return
        }

        now := time.Now().UTC().Format(time.RFC3339)
        if body.Error != "" {
                _, _ = db.Exec("UPDATE Job SET status = 'failed', stageLabel = 'Ошибка', error = ?, completedAt = ? WHERE id = ?", body.Error, now, body.JobID)
                logEvent(body.JobID, "error", "Ошибка рендеринга: "+body.Error)
        } else {
                _, _ = db.Exec("UPDATE Job SET status = 'completed', stageKey = 'done', stageLabel = 'Готово', progress = 100, resultUrl = ?, thumbUrl = ?, completedAt = ? WHERE id = ?", body.ResultURL, body.ThumbURL, now, body.JobID)
                logEvent(body.JobID, "info", "Монтаж успешно завершён. Файл доступен.")
        }

        jsonResponse(w, map[string]any{"success": true}, http.StatusOK)
}

// --- Админ API --------------------------------------------------------------

func handleAdminOverview(w http.ResponseWriter, r *http.Request) {
        var queued, completed int
        var activeJob sql.NullString

        _ = db.QueryRow("SELECT COUNT(*) FROM Job WHERE status = 'queued'").Scan(&queued)
        _ = db.QueryRow("SELECT COUNT(*) FROM Job WHERE status = 'completed'").Scan(&completed)
        _ = db.QueryRow("SELECT id FROM Job WHERE status = 'processing' LIMIT 1").Scan(&activeJob)

        res := map[string]any{
                "queueLength":    queued,
                "activeJob":      activeJob.String,
                "completedToday": completed,
                "totalUsers":     1,
                "ramMb":          12,
                "workerOnline":   true,
        }
        jsonResponse(w, res, http.StatusOK)
}

func handleAdminUsers(w http.ResponseWriter, r *http.Request) {
        u := User{
                ID:         "u_admin",
                TelegramID: "8519049699",
                Username:   "admin",
                FirstName:  "Сергей",
                Role:       "admin",
                DailyUsed:  0,
                DailyLimit: 999,
        }
        jsonResponse(w, map[string]any{"users": []any{map[string]any{"id": u.ID, "username": u.Username, "firstName": u.FirstName, "role": u.Role, "dailyUsed": u.DailyUsed, "dailyLimit": u.DailyLimit, "_count": map[string]int{"jobs": 5}}}}, http.StatusOK)
}

func handleAdminEvents(w http.ResponseWriter, r *http.Request) {
        rows, err := db.Query("SELECT id, jobId, level, message, createdAt FROM Event ORDER BY createdAt DESC LIMIT 60")
        if err != nil {
                jsonResponse(w, map[string]any{"events": []any{}}, http.StatusOK)
                return
        }
        defer rows.Close()

        var evs []LogEvent
        for rows.Next() {
                var e LogEvent
                _ = rows.Scan(&e.ID, &e.JobID, &e.Level, &e.Message, &e.CreatedAt)
                evs = append(evs, e)
        }
        jsonResponse(w, map[string]any{"events": evs}, http.StatusOK)
}

func handleAdminSettings(w http.ResponseWriter, r *http.Request) {
        settings := []map[string]string{
                {"key": "worker_enabled", "value": "true"},
                {"key": "global_daily_limit", "value": "3"},
                {"key": "max_file_mb", "value": "500"},
                {"key": "worker_ram_budget_mb", "value": "12000"},
        }
        jsonResponse(w, map[string]any{"settings": settings}, http.StatusOK)
}

func main() {
        port := os.Getenv("PORT")
        if port == "" {
                port = "8445"
        }
        dbPath := os.Getenv("DATABASE_PATH")
        if dbPath == "" {
                dbPath = "/opt/montage-webapp/db/custom.db"
        }

        if err := initDB(dbPath); err != nil {
                log.Fatalf("Init DB error: %v", err)
        }
        log.Printf("DB initialized at %s", dbPath)

        mux := http.NewServeMux()

        // Роуты API Mini App
        mux.HandleFunc("/api/auth", handleAuth)
        mux.HandleFunc("/api/showcase", handleShowcase)
        mux.HandleFunc("/api/jobs", handleJobs)
        mux.HandleFunc("/api/jobs/", handleJobDetail)

        // Роуты админки
        mux.HandleFunc("/api/admin/overview", handleAdminOverview)
        mux.HandleFunc("/api/admin/users", handleAdminUsers)
        mux.HandleFunc("/api/admin/events", handleAdminEvents)
        mux.HandleFunc("/api/admin/settings", handleAdminSettings)

        // Роуты pull-воркера (ноутбук 12 ГБ)
        mux.HandleFunc("/api/worker/next-job", handleWorkerNext)
        mux.HandleFunc("/api/worker/progress", handleWorkerProgress)
        mux.HandleFunc("/api/worker/complete", handleWorkerComplete)

        addr := "127.0.0.1:" + port
        log.Printf("Montage Go Micro-API listening on %s (Zero-Touch RAM < 15MB)", addr)
        if err := http.ListenAndServe(addr, mux); err != nil {
                log.Fatalf("Server error: %v", err)
        }
}
