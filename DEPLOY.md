# 🚀 Инструкция по развёртыванию (Deployment Guide)

> Руководство по развёртыванию «Монтажной Кухни» на сервере (Linux / Ubuntu / Mint / Debian) по стандарту Zero-Touch Deploy.

---

## 1. Системные требования
- **ОС**: Linux (Ubuntu 22.04+, Debian 12+, Linux Mint).
- **ОЗУ**: 12 ГБ (наш лимит, соблюдается за счёт строгого FIFO слота воркера).
- **Диск**: 30+ ГБ свободного места (для временных медиафайлов и кэша Whisper).
- **ПО**: Docker + Docker Compose, либо Python 3.11+ и Node.js 20+.
- **FFmpeg**: v6.0+ с поддержкой `libx264`, `aac`, шрифтами `fonts-dejavu-core`.

---

## 2. Переменные окружения (.env)

Создайте `.env` в корне проекта:
```ini
# Токен Telegram бота (получить у @BotFather)
TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrSTUvwxyz"

# Внешний URL для Telegram WebApp (должен быть HTTPS в продакшене)
WEBAPP_URL="https://montage.yourdomain.com"

# База данных SQLite (Prisma)
DATABASE_URL="file:./db/custom.db"
DATABASE_PATH="/home/qwerty/projects/montage-telegram-bot/db/custom.db"

# Каталог медиафайлов
MEDIA_DIR="/home/qwerty/projects/montage-telegram-bot/media"

# Путь к локальному движку video-montage v2.0.0
VIDEO_MONTAGE_DIR="/home/qwerty/.config/opencode/skills/video-montage"
```

---

## 3. Вариант A: Развёртывание через Docker Compose (Рекомендуется)

1. Клонируйте репозиторий и перейдите в папку:
```bash
git clone https://github.com/Sereban-glitch/montage-telegram-bot.git
cd montage-telegram-bot
```

2. Соберите и запустите контейнеры:
```bash
docker compose up -d --build
```

3. Проверьте статус сервисов:
```bash
docker compose ps
docker compose logs -f worker
```

---

## 4. Вариант B: Развёртывание через Systemd (Zero-Touch Native)

Если на сервере сервисы запускаются без Docker:

1. Скопируйте unit-файлы в систему:
```bash
sudo cp deploy/montage-webapp.service /etc/systemd/system/
sudo cp deploy/montage-bot.service /etc/systemd/system/
sudo cp deploy/montage-worker.service /etc/systemd/system/
```

2. Перезагрузите systemd daemon:
```bash
sudo systemctl daemon-reload
```

3. Включите автозапуск и активируйте сервисы:
```bash
sudo systemctl enable --now montage-webapp
sudo systemctl enable --now montage-bot
sudo systemctl enable --now montage-worker
```

4. Проверка статуса:
```bash
sudo systemctl status montage-webapp montage-bot montage-worker
```

---

## 5. Настройка HTTPS (Caddy / Nginx)

Telegram требует валидный SSL (HTTPS) для работы WebApp.

### Конфигурация для Caddy:
```caddy
montage.yourdomain.com {
    reverse_proxy localhost:3000
    encode gzip zstd
}
```

### Конфигурация для Nginx:
```nginx
server {
    server_name montage.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 500M;
    }
}
```

---

## 6. Проверка работоспособности конвейера

1. Откройте диалог с вашим ботом в Telegram и отправьте `/start`.
2. Нажмите кнопку **«🎬 Открыть Монтажную Кухню»** — откроется WebApp с вкладками Shorts, Long, Витрина, Задачи.
3. Отправьте тестовое видео в чат или загрузите через вкладку «Монтаж Shorts».
4. В админ-панели (`/` -> вкладка «Админка») проверьте:
   - Появление задачи в очереди.
   - Захват задачи воркером.
   - Прогресс по этапам (скачивание → аудио → транскрипция → рендер → обложка → нормализация).
   - Получение готового MP4 файла в чате Telegram.
