/**
 * Render film.html frame by frame with headless Chrome.
 * usage: node capture.mjs <timeline.json> <outDir> <fps> [workers]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [tlPath, outDir, fpsArg, workersArg] = process.argv.slice(2);
const timeline = JSON.parse(fs.readFileSync(tlPath, 'utf8'));
const fps = Number(fpsArg || 30);
const workers = Number(workersArg || 4);
const total = timeline.at(-1).start + timeline.at(-1).dur;
const frames = Math.ceil(total * fps);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--font-render-hinting=none', '--disable-gpu'] });
async function worker(w) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(here, 'film.html')}`);
  await page.evaluate((tl) => { window.TIMELINE = tl; }, timeline);
  await page.evaluate(() => document.fonts.ready);
  for (let i = w; i < frames; i += workers) {
    await page.evaluate((t) => window.render(t), i / fps);
    await page.screenshot({ path: path.join(outDir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (w === 0 && i % (fps * 10) === 0) console.log(`frame ${i}/${frames}`);
  }
  await page.close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
const cues = await (async () => { const p = await browser.newPage(); await p.goto(`file://${path.join(here, 'film.html')}`); const c = await p.evaluate(() => window.CUES); await p.close(); return c; })();
fs.writeFileSync(path.join(path.dirname(tlPath), 'cues.json'), JSON.stringify(cues));
await browser.close();
console.log(`done: ${frames} frames`);
