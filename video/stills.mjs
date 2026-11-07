import { chromium } from 'playwright-core';
import fs from 'node:fs';
const tl = JSON.parse(fs.readFileSync('build/timeline.json', 'utf8'));
const at = (id, lt) => tl.find((s) => s.id === id).start + lt;
const shots = process.argv.slice(2).map((x) => { const [id, lt] = x.split(':'); return [id, Number(lt)]; });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${process.cwd()}/film.html`);
await page.evaluate((t) => { window.TIMELINE = t; }, tl);
await page.evaluate(() => document.fonts.ready);
fs.mkdirSync('build/stills', { recursive: true });
for (const [id, lt] of shots) {
  await page.evaluate((t) => window.render(t), at(id, lt));
  await page.screenshot({ path: `build/stills/${id}-${lt}.jpg`, type: 'jpeg', quality: 80 });
}
await browser.close();
console.log('ok');
