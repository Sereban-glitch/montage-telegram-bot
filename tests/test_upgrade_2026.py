"""Unit-тесты апгрейда-2026 (P0–P3) — без сети, БД и ffmpeg-запусков.

Проверяются чистые функции: разбор silencedetect, план вырезки, ремап
субтитров, аргументы VAAPI/фолбэка, SFX-план и команда микса, дакинг-фильтр,
голоса/план дубляжа, варианты названий, B-roll-команды.

Запуск:  python3 tests/test_upgrade_2026.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "worker"))

from app import broll, dub, hwaccel, music_duck, sfx, silence_cutter  # noqa: E402
from app.hook_scorer import make_title_variants  # noqa: E402


# ----------------------------------------------------------------
# P1: silence_cutter
# ----------------------------------------------------------------

SAMPLE_LOG = """[silencedetect @ 0x...] silence_start: 12.340
[silencedetect @ 0x...] silence_end: 13.9 | silence_duration: 1.56
[silencedetect @ 0x...] silence_start: 40.0
[silencedetect @ 0x...] silence_end: 41.2 | silence_duration: 1.2
[silencedetect @ 0x...] silence_start: 55.5
"""


def test_parse_silencedetect():
    out = silence_cutter.parse_silencedetect(SAMPLE_LOG)
    assert (12.34, 13.9) in out and (40.0, 41.2) in out
    # незакрытый интервал не теряется
    assert any(s == 55.5 for s, _ in out)
    assert len(out) == 3, out
    print("OK  parse_silencedetect: 2 закрытых + 1 незакрытый интервал")


def test_tighten_edits():
    edits = [[0.0, 60.0]]
    silences = [(12.34, 13.9), (40.0, 41.2)]
    tightened = silence_cutter.tighten_edits(edits, silences)
    assert len(tightened) == 3, tightened
    assert tightened[0] == [0.0, 12.22], tightened[0]      # 12.34 - pad 0.12
    assert tightened[1][0] == 14.02, tightened[1]          # 13.9 + pad 0.12
    assert tightened[2] == [41.32, 60.0], tightened[2]
    saved = silence_cutter.cut_duration(edits) - silence_cutter.cut_duration(tightened)
    assert 3.0 < saved < 3.5, saved  # 2×(тишина + 2×pad) = 1.8+1.44 = 3.24
    print(f"OK  tighten_edits: 1 интервал → 3 куска, вырезано {saved:.2f} с")


def test_tighten_edits_no_overlap():
    # тишина ВНЕ монтажного окна не влияет
    tightened = silence_cutter.tighten_edits([[0.0, 10.0]], [(50.0, 52.0)])
    assert tightened == [[0.0, 10.0]]
    print("OK  tighten_edits: тишина вне окна игнорируется")


def test_remap_captions():
    captions = [[0.0, 12.0, "речь до паузы"], [12.5, 13.5, "э-э"], [14.5, 20.0, "речь после"]]
    silences = [(12.34, 13.9)]
    out = silence_cutter.remap_captions(captions, silences)
    texts = [c[2] for c in out]
    assert "э-э" not in texts, "короткая реплика в паузе не отброшена"
    first, last = out[0], out[-1]
    assert abs(first[1] - 12.0) < 0.01  # до выреза — без сдвига
    # после выреза ~1.56+0.24=1.8 c: 14.5 → ~12.7
    assert abs(last[0] - (14.5 - 1.8)) < 0.05, last
    print(f"OK  remap_captions: сдвиг {14.5 - last[0]:.2f} c, «э-э» отброшен")


# ----------------------------------------------------------------
# P0: hwaccel
# ----------------------------------------------------------------

def test_hwaccel_software_fallback():
    import os
    hwaccel.detect.cache_clear()
    # Принудительно отключаем hwaccel, чтобы проверить корректность софтверного фолбэка
    os.environ["MONTAGE_HWACCEL"] = "off"
    try:
        assert hwaccel.detect() is None
        args = hwaccel.encoder_args(21)
        assert args[:2] == ["-c:v", "libx264"] and "-crf" in args
        assert hwaccel.input_hw_args() == []
        assert hwaccel.scale_filter(960).startswith("scale=-2:")
        assert hwaccel.hw_name() == "off"
    finally:
        del os.environ["MONTAGE_HWACCEL"]
        hwaccel.detect.cache_clear()
    print("OK  hwaccel: фолбэк libx264 без VA-API (аргументы корректны)")


def test_hwaccel_env_off(monkeypatch_env=None):
    import os
    hwaccel.detect.cache_clear()
    os.environ["MONTAGE_HWACCEL"] = "off"
    try:
        assert hwaccel.detect() is None
    finally:
        del os.environ["MONTAGE_HWACCEL"]
        hwaccel.detect.cache_clear()
    print("OK  hwaccel: MONTAGE_HWACCEL=off отключает VAAPI")


def test_hwaccel_vaapi_args(monkeypatch_detect=True):
    # симулируем найденный VAAPI — проверяем форму аргументов энкодера
    orig = hwaccel.detect
    hwaccel.detect = lambda: "vaapi"
    try:
        args = hwaccel.encoder_args(22)
        assert args[:2] == ["-c:v", "h264_vaapi"] and "-global_quality" in args
        assert hwaccel.scale_filter(960) == "scale_vaapi=-2:960:format=nv12"
        assert "-vaapi_device" in hwaccel.input_hw_args()
    finally:
        hwaccel.detect = orig
    print("OK  hwaccel: vaapi-аргументы (h264_vaapi CQP, scale_vaapi)")


# ----------------------------------------------------------------
# P1: sfx
# ----------------------------------------------------------------

def test_sfx_plan():
    edits = [[0.0, 12.0], [13.9, 30.0], [31.0, 45.0], [46.0, 60.0]]
    plan = sfx.sfx_plan(edits)
    assert plan[0]["at"] == 13.9, "первый акцент на второй склейке"
    assert all(p["kind"] in sfx.SFX_KINDS for p in plan)
    assert len(plan) == 3, plan  # 4 куска → 3 склейки
    assert sfx.sfx_plan([[0.0, 10.0]]) == [], "один кусок — без акцентов"
    print(f"OK  sfx_plan: {len(plan)} акцентов на склейках, первый {plan[0]}")


def test_sfx_mix_cmd():
    video, out = Path("/tmp/v.mp4"), Path("/tmp/o.mp4")
    files = [Path("/tmp/a.wav"), Path("/tmp/b.wav")]
    cmd = sfx.build_mix_cmd(video, files, [1500, 3200], out)
    joined = " ".join(cmd)
    assert "adelay=1500" in joined and "adelay=3200" in joined
    assert "amix=inputs=3" in joined and "weights=1 0.22 0.22" in joined
    assert "-c:v" in joined and "copy" in joined, "видео не должно перекодироваться"
    assert cmd[-1] == str(out)
    print("OK  sfx.build_mix_cmd: adelay + amix weights, видео stream-copy")


# ----------------------------------------------------------------
# P1/P2: music_duck
# ----------------------------------------------------------------

def test_duck_filter():
    f = music_duck.build_duck_filter()
    assert "sidechaincompress" in f and "amix=inputs=2" in f
    assert "normalize=0" in f, "громкости не должны ренормализовываться"
    assert f.startswith("[1:a]volume=-13.0dB")
    cmd = music_duck.duck_cmd(Path("/v.mp4"), Path("/m.mp3"), Path("/o.mp4"))
    assert "copy" in " ".join(cmd)
    print("OK  music_duck: sidechain-дакинг + stream-copy видео")


# ----------------------------------------------------------------
# P3: dub
# ----------------------------------------------------------------

def test_dub_voices():
    assert dub.pick_voice("uk", "ru") == "ru-RU-DmitryNeural"
    assert dub.pick_voice("ru", "uk") == "uk-UA-OstapNeural"
    assert dub.pick_voice("uk", "ru", alt=True) == "ru-RU-SvetlanaNeural"
    print("OK  dub.pick_voice: UA→RU Dmitry, RU→UA Ostap (+альт)")


def test_plan_dub_filters_fillers():
    rows = [
        {"start": 0, "end": 1, "text": "е-е"},
        {"start": 1, "end": 5, "text": "Верховний Суд відповів на це питання."},
        {"start": 5, "end": 6, "text": "ну"},
        {"start": 6, "end": 12, "text": "Це рішення змінило практику посилень."},
    ]
    out = dub.plan_dub(rows)
    assert len(out) == 2, out
    assert out[0]["text"].startswith("Верховний")
    print("OK  dub.plan_dub: заполнители «е-э»/«ну» отфильтрованы")


def test_translate_without_key():
    try:
        dub.translate_lines(["привіт"], "uk", "ru", "", "", "")
        raise AssertionError("должен был бросить DubUnavailable")
    except dub.DubUnavailable as e:
        assert "LLM" in str(e) or "MONTAGE" in str(e)
    print("OK  dub.translate_lines: без ключа — мягкий DubUnavailable")


def test_dub_mix_cmd():
    cmd = dub.build_dub_mix_cmd(Path("/v.mp4"), Path("/d.wav"), Path("/o.mp4"))
    joined = " ".join(cmd)
    assert "volume=-11.0dB" in joined, "оригинал приглушается"
    assert "amix=inputs=2" in joined and "copy" in joined
    print("OK  dub.build_dub_mix_cmd: оригинал -11 dB, дуб сверху, copy")


# ----------------------------------------------------------------
# P2: hook_scorer.make_title_variants
# ----------------------------------------------------------------

def test_title_variants():
    text = ("Чи можна повернути гроші, якщо расписки немає? Верховний Суд "
            "відповів, і відповідь багатьох здивує. Суд дослідив листування.")
    base = "Що вирішив суд: повернути гроші без расписки"
    variants = make_title_variants(text, base)
    assert len(variants) == 3, variants
    assert variants[0] == base
    assert len(set(v.lower() for v in variants)) == 3, "варианты должны различаться"
    assert all(len(v) <= 72 for v in variants)
    print(f"OK  make_title_variants: {variants}")


# ----------------------------------------------------------------
# P2: broll
# ----------------------------------------------------------------

def test_broll_no_key():
    try:
        broll.search_videos("суд", None)
        raise AssertionError("должен был бросить PexelsUnavailable")
    except broll.PexelsUnavailable:
        pass
    print("OK  broll: без PEXELS_API_KEY — мягкий skip")


def test_broll_overlay_cmd():
    cmd = broll.overlay_broll_cmd(Path("/v.mp4"), Path("/b.mp4"), Path("/o.mp4"))
    joined = " ".join(cmd)
    assert "scale=1080:1920" in joined and "fade=t=out" in joined
    assert "overlay=0:0" in joined
    print("OK  broll.overlay_broll_cmd: 1080×1920 + fade-out оверлей")


def test_broll_attribution():
    s = broll.attribution([{"page": "https://pexels.com/video/1"}, {"page": "https://pexels.com/video/1"}])
    assert s.count("pexels.com") == 1, "дубликаты атрибуции не схлопнуты"
    assert broll.attribution([{}]) == ""
    print("OK  broll.attribution: дедупликация ссылок")


if __name__ == "__main__":
    test_parse_silencedetect()
    test_tighten_edits()
    test_tighten_edits_no_overlap()
    test_remap_captions()
    test_hwaccel_software_fallback()
    test_hwaccel_env_off()
    test_hwaccel_vaapi_args()
    test_sfx_plan()
    test_sfx_mix_cmd()
    test_duck_filter()
    test_dub_voices()
    test_plan_dub_filters_fillers()
    test_translate_without_key()
    test_dub_mix_cmd()
    test_title_variants()
    test_broll_no_key()
    test_broll_overlay_cmd()
    test_broll_attribution()
    print("\n=== ВСЕ ТЕСТЫ АПГРЕЙДА-2026 (P0–P3) ПРОЙДЕНЫ ===")
