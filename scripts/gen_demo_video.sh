#!/bin/bash
# Демо-результат рендера: вертикальный short 540x960, 6 сек, с титулом и субтитром,
# имитирует вывод движка Sereban-glitch-video-montage (final.mp4)
set -e
OUT=/home/z/my-project/public/demo/final_short.mp4
ffmpeg -y -f lavfi -i "color=c=0x101820:s=540x960:d=6:r=30" \
  -f lavfi -i "sine=frequency=220:duration=6" \
  -vf "drawtext=text='МОНТАЖНАЯ КУХНЯ':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=180:borderw=2:bordercolor=0x3390ec, \
       drawtext=text='демо-вывод движка v2.0.0':fontcolor=0x9fb3c8:fontsize=20:x=(w-text_w)/2:y=240, \
       drawtext=text='Суд сказал — у правительства':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-260:borderw=1:bordercolor=black, \
       drawtext=text='нет таких полномочий':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-216:borderw=1:bordercolor=black, \
       drawtext=text='%{pts\:hms}':fontcolor=0x3390ec:fontsize=22:x=(w-text_w)/2:y=60" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -shortest "$OUT" 2>&1 | tail -2
echo "OK: $OUT"
