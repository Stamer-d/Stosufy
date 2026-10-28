// Filmstrip: each page opened (and gone back to) on a slow network and CPU, a picture every few
// ms, how much of the screen is empty in each. FRAMES=dir keeps the pictures.
const { devices } = require('playwright');
const { setup, login, launch, touchInput, isChromium } = require('./harness.cjs');
const BASE = 'http://127.0.0.1:5288/Stosufy';
const OUT = process.env.FRAMES;
let p;
const wait = (ms) => p.waitForTimeout(ms);


(async () => {
  const b = await launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await setup(ctx);
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  p = await ctx.newPage();
  const { cdp } = await touchInput(p);
  await login(p);
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const fs = require('fs');
  async function film(name, act) {
    const shots = [];
    const t0 = Date.now();
    const going = act();
    for (let i = 0; i < 12; i++) {
      const buf = await p.screenshot({ clip: { x: 0, y: 0, width: 390, height: 600 } });
      shots.push([Date.now() - t0, buf]);
    }
    await going; await wait(1500);
    const rows = [];
    for (const [i, [t, buf]] of shots.entries()) {
      if (OUT) fs.writeFileSync(`${OUT}/${name}-${String(i).padStart(2, '0')}-${t}ms.png`, buf);
      rows.push(t);
    }
    console.log(name, 'frames at', rows.join(','));
  }
  const tab = async (n) => { await p.click(`nav button:has-text("${n}")`); await wait(800); };
  await tab('Library');
  await film('open-playlist', () => p.click('text=Chill'));
  await film('back-playlist', () => p.click('main header a[aria-label="Back"]'));
  await tab('Home'); await wait(800);
  await film('open-community', async () => { const l = p.locator('a[href$="/community"]').first(); if (await l.count()) await l.click(); else await p.goto(BASE + '/community'); });
  await tab('Library'); await p.click('text=Chill'); await wait(1200);
  await p.locator('main ol > li').first().locator('button[aria-label^="More"]').click(); await wait(400);
  await film('open-map', () => p.click('text=Go to beatmap'));
  await film('back-map', () => p.click('main header a[aria-label="Back"]'));
  await tab('Search');
  await film('open-friends', () => p.goto(BASE + '/friends'));
  await b.close();
})();
