import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUT = '/home/z/my-project/public/showcase';
fs.mkdirSync(OUT, { recursive: true });

const jobs = [
  { file: 'short-court.png', size: '768x1344', prompt: 'Vertical 9:16 video thumbnail background, dramatic photo of a Ukrainian courtroom during session, judge bench, wooden panels, documents on desk, cinematic moody lighting, teal and dark tones, no text, high quality, photorealistic' },
  { file: 'short-street.png', size: '768x1344', prompt: 'Vertical 9:16 video thumbnail background, photojournalism shot of a city street in eastern Ukraine, Soviet-era apartment blocks, overcast sky, a reporter silhouette holding microphone, cinematic grading, no text, high quality, photorealistic' },
  { file: 'short-press.png', size: '768x1344', prompt: 'Vertical 9:16 video thumbnail background, press conference scene, cluster of microphones at a podium, blurred audience, dramatic spotlight, dark blue tones, cinematic, no text, high quality, photorealistic' },
  { file: 'short-mic.png', size: '768x1344', prompt: 'Vertical 9:16 video thumbnail background, close-up of a professional interview microphone in front of blurred speaker, shallow depth of field, dark studio background with rim light, cinematic teal-orange grading, no text, high quality, photorealistic' },
  { file: 'long-session.png', size: '1344x768', prompt: 'Wide 16:9 video thumbnail background, panoramic photo of an official court hearing session, rows of chairs, lawyer at table with microphone, flags, fluorescent lighting, documentary photography style, no text, high quality, photorealistic' },
  { file: 'long-lecture.png', size: '1344x768', prompt: 'Wide 16:9 video thumbnail background, public lecture hall with speaker at podium and projection screen, audience silhouettes, warm stage lighting, documentary style, no text, high quality, photorealistic' },
  { file: 'banner.png', size: '1440x704', prompt: 'Wide cinematic banner, dark professional video editing studio at night, multiple monitors showing video timeline and waveform, neon blue accent lighting, film reels and clapperboard on desk, shallow depth of field, moody, high quality, photorealistic, no text' },
];

const zai = await ZAI.create();
for (const job of jobs) {
  const outPath = path.join(OUT, job.file);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) {
    console.log('skip', job.file);
    continue;
  }
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const res = await zai.images.generations.create({ prompt: job.prompt, size: job.size });
      const b64 = res?.data?.[0]?.base64;
      if (!b64) throw new Error('empty base64');
      fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
      console.log('OK', job.file, fs.statSync(outPath).size);
      ok = true;
    } catch (e) {
      console.error(`attempt ${attempt} failed for ${job.file}:`, e.message);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  if (!ok) console.error('FAILED', job.file);
}
console.log('DONE');
