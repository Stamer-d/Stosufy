// The phone suite: gestures (and cancelling them), the keyboard, a long session (leaks), a
// performance budget on a slowed-down CPU, offline, a breaking stream. Installed-app mode.
const { devices } = require('playwright');
const { setup, login, launch, touchInput, isChromium, BROWSER } = require('./harness.cjs');
const BASE = 'http://127.0.0.1:5288/Stosufy';
const results = [];
let p, cdp, finger;
const wait = (ms) => p.waitForTimeout(ms);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '—', String(e.message).split('\n')[0]); await p.screenshot({ path: `mfail-${results.length}.png` }).catch(() => {}); await p.goto(BASE + '/').catch(() => {}); await wait(1200); }
}
const touch = (type, x, y) => finger(type, x, y);
/** A drag: `steps` moves of `ms` each (slow drags and flicks) */
async function drag(x0, y0, dx, dy, steps = 10, ms = 16, back = 0) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (dx * i) / steps, y0 + (dy * i) / steps); await wait(ms); }
  // (turning back at the end)
  for (let i = 1; i <= back; i++) { await touch('touchMove', x0 + dx - (dx * 0.1 * i), y0 + dy - (dy * 0.1 * i)); await wait(ms); }
  await touch('touchEnd');
}
const path = () => p.url().replace(/.*Stosufy/, '') || '/';
const playerOpen = () => p.locator('.fixed.inset-0.z-30').count();
const menuOpen = () => p.locator('.fixed.inset-0.z-40').count();
const underlays = () => p.evaluate(() => document.querySelectorAll('body > .fixed.inset-0.overflow-hidden.pointer-events-none').length);
const mainMoved = () => p.evaluate(() => document.querySelector('main').style.transform);
const tab = async (name) => { await p.click(`nav button:has-text("${name}")`); await wait(600); };
const playFirst = async () => { await p.locator('main ol > li').first().locator('button').first().click(); await wait(800); };
const nowTitle = () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('stosufy-web-player') || '{}'); return s.songs?.[s.index]?.title; });

(async () => {
  const b = await launch();
  console.log('engine:', BROWSER);
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await setup(ctx);
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  ({ cdp, touch: finger } = await touchInput(p));
  const errors = [];
  // (WebKit reports a request cut off by a reload as "…due to access control checks": not the app's)
  p.on('pageerror', (e) => !/due to access control checks/.test(e.message) && errors.push(e.message));
  await login(p);
  const W = 390;

  // --- Going back -------------------------------------------------------------------------
  await step('edge swipe back: page before under the finger, then there', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900);
    await touch('touchStart', 8, 400); for (let i = 1; i <= 5; i++) { await touch('touchMove', 8 + i * 30, 400); await wait(16); }
    expect((await underlays()) === 1, 'no page under the finger');
    await touch('touchEnd'); await wait(900);
    expect(path() === '/library', 'at ' + path());
    expect((await underlays()) === 0 && !(await mainMoved()), 'left something behind');
  });
  await step('edge swipe: dragged a bit and let go slowly = stays', async () => {
    await p.click('text=Chill'); await wait(900);
    await drag(8, 400, 80, 0, 12, 40);
    await wait(500);
    expect(path() === '/playlist/2', 'went back at ' + path());
    expect((await underlays()) === 0 && !(await mainMoved()), 'left something behind');
  });
  await step('edge swipe: far, then turned back = stays', async () => {
    await drag(8, 400, 250, 0, 10, 16, 8);
    await wait(500);
    expect(path() === '/playlist/2', 'went back at ' + path());
    expect((await underlays()) === 0 && !(await mainMoved()), 'left something behind');
  });
  await step('edge swipe: a short flick = back', async () => {
    await drag(8, 400, 70, 0, 4, 10);
    await wait(900);
    expect(path() === '/library', 'at ' + path());
  });
  await step('a vertical scroll from the edge is no back swipe', async () => {
    await p.click('text=Chill'); await wait(900);
    await drag(8, 500, 6, -250, 10, 16);
    await wait(500);
    expect(path() === '/playlist/2', 'went back at ' + path());
    expect((await underlays()) === 0, 'underlay left');
  });
  await step('back arrow = back in the tab', async () => {
    await p.locator('main a[aria-label="Back"]').last().click(); await wait(800);
    expect(path() === '/library', 'at ' + path());
  });
  await step('tab start: no swipe back', async () => {
    await drag(8, 400, 250, 0);
    await wait(500);
    expect(path() === '/library', 'at ' + path());
  });
  await step('deep chain: home → mix → beatmap, back, back', async () => {
    await tab('Home'); await p.locator('a[href*="/mix/"]').first().click(); await wait(900);
    await p.locator('main ol > li').first().locator('button[aria-label^="More"]').click(); await wait(300);
    await p.click('text=Go to beatmap'); await wait(1200);
    await drag(8, 400, 250, 0); await wait(900);
    expect(path().startsWith('/mix/'), 'first back at ' + path());
    await drag(8, 400, 250, 0); await wait(900);
    expect(path() === '/', 'second back at ' + path());
  });

  // --- The player and the sheets ----------------------------------------------------------
  await step('dock: swipe the song = next; back = before', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    const first = await nowTitle();
    const box = await p.locator('[aria-label="Swipe for the next song or the one before"]').first().boundingBox();
    await drag(box.x + box.width * 0.7, box.y + box.height / 2, -180, 0, 8, 16); await wait(700);
    const second = await nowTitle();
    expect(second && second !== first, 'no next');
    await drag(box.x + box.width * 0.3, box.y + box.height / 2, 180, 0, 8, 16); await wait(700);
    expect((await nowTitle()) === first, 'not back');
  });
  await step('dock: a small swipe springs back (same song)', async () => {
    const before = await nowTitle();
    const box = await p.locator('[aria-label="Swipe for the next song or the one before"]').first().boundingBox();
    await drag(box.x + box.width * 0.6, box.y + box.height / 2, -40, 0, 10, 40); await wait(600);
    expect((await nowTitle()) === before, 'changed song');
  });
  await step('player: open, swipe down a little = stays, flick = closes', async () => {
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(700);
    expect(await playerOpen(), 'not open');
    await drag(200, 150, 0, 60, 10, 40); await wait(500);
    expect(await playerOpen(), 'closed on a small drag');
    await drag(200, 150, 0, 120, 4, 10); await wait(600);
    expect(!(await playerOpen()), 'still open after a flick');
  });
  await step('player: scrubber drag doesn\'t close the player', async () => {
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(700);
    const r = await p.locator('.fixed.inset-0.z-30 [role="slider"]').boundingBox();
    await drag(r.x + 20, r.y + r.height / 2, 150, 40, 10, 16); await wait(500);
    expect(await playerOpen(), 'player closed');
  });
  await step('player: speed sheet swipes down, the player stays', async () => {
    await p.click('.fixed.inset-0.z-30 button[aria-label^="Speed mod"]'); await wait(500);
    expect(await menuOpen(), 'sheet not open');
    const sheet = await p.locator('.fixed.inset-0.z-40 > div.relative').boundingBox();
    await drag(200, sheet.y + 30, 0, 200, 6, 12); await wait(600);
    expect(!(await menuOpen()), 'sheet still open');
    expect(await playerOpen(), 'player closed too');
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(500);
  });
  await step('song menu: swipe down closes', async () => {
    await p.locator('main ol > li').nth(1).locator('button[aria-label^="More"]').click(); await wait(400);
    const sheet = await p.locator('.fixed.inset-0.z-40 > div.relative').boundingBox();
    await drag(200, sheet.y + 30, 0, 250, 6, 12); await wait(600);
    expect(!(await menuOpen()), 'still open');
  });
  await step('search filter sheet: swipe down closes', async () => {
    await tab('Search'); await p.click('header button:has-text("Genre")'); await wait(400);
    const sheet = await p.locator('.fixed.inset-0.z-40 > div.relative').boundingBox();
    await drag(200, sheet.y + 30, 0, 250, 6, 12); await wait(600);
    expect(!(await menuOpen()), 'still open');
  });

  // --- The keyboard -----------------------------------------------------------------------
  await step('typing hides the tab bar; scrolling puts the keyboard away', async () => {
    await p.click('input[aria-label="Search"]'); await wait(300);
    expect(await p.evaluate(() => document.documentElement.classList.contains('typing')), 'not typing');
    const y = await p.evaluate(() => document.querySelector('.dock').getBoundingClientRect().top);
    expect(y >= 600, 'tab bar still there at ' + y);
    await p.keyboard.type('song'); await wait(900);
    await drag(200, 500, 0, -150, 8, 16); await wait(400);
    expect(!(await p.evaluate(() => document.documentElement.classList.contains('typing'))), 'still typing');
  });

  // --- Offline ----------------------------------------------------------------------------
  await step('offline: banner, back online: gone', async () => {
    await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await wait(800);
    expect(await p.locator("text=You're offline").count(), 'no banner');
    await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(1500);
    expect(!(await p.locator("text=You're offline").count()), 'banner stays');
  });

  // --- A long session -----------------------------------------------------------------------
  let start;
  await step('long session: 60 page changes and 20 players later, no leaks', async () => {
    await p.goto(BASE + '/'); await wait(1500);
    const measure = () => p.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6) }));
    if (cdp) await cdp.send('HeapProfiler.collectGarbage');
    start = await measure();
    for (let round = 0; round < 15; round++) {
      await tab('Library'); await p.click('text=Chill'); await wait(400);
      await drag(8, 400, 250, 0); await wait(500);
      await tab('Home'); await p.locator('a[href*="/mix/"]').first().click(); await wait(400);
      await drag(8, 400, 250, 0); await wait(500);
      if (round % 1 === 0) { await p.locator('button[aria-label="Open the player"]').first().click().catch(() => {}); await wait(300); await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]').catch(() => {}); await wait(300); }
    }
    await tab('Home'); await wait(800);
    if (cdp) await cdp.send('HeapProfiler.collectGarbage');
    await wait(500);
    const end = await measure();
    console.log('   start', JSON.stringify(start), 'end', JSON.stringify(end), 'underlays', await underlays());
    expect(end.nodes < start.nodes * 1.3 + 200, `DOM grew ${start.nodes} → ${end.nodes}`);
    expect(!end.heap || end.heap < start.heap * 1.6 + 15, `heap grew ${start.heap} → ${end.heap} MB`);
    expect((await underlays()) === 0, 'underlays left');
  });

  // --- Performance budget -------------------------------------------------------------------
  if (isChromium) await step('slowed-down CPU (4×): no interaction blocks > 300 ms, nothing drawn while idle', async () => {
    await p.evaluate(() => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask' }); });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const worst = [];
    const act = async (name, fn) => { await p.evaluate(() => (window.__long = [])); await fn(); await wait(1500); const l = await p.evaluate(() => window.__long); worst.push([name, Math.max(0, ...l)]); };
    await act('library tab', () => tab('Library'));
    await act('open playlist', () => p.click('text=Big playlist'));
    await act('play', playFirst);
    await act('open player', () => p.locator('button[aria-label="Open the player"]').first().click());
    await act('next', () => p.click('.fixed.inset-0.z-30 button[aria-label="Next"]'));
    await act('close player', () => p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'));
    await act('swipe back', () => drag(8, 400, 250, 0));
    await act('home tab', () => tab('Home'));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('   longest block per action:', worst.map(([n, ms]) => `${n} ${ms}`).join(', '));
    const bad = worst.filter(([, ms]) => ms > 300);
    expect(!bad.length, 'too slow: ' + bad.map(([n, ms]) => `${n} ${ms} ms`).join(', '));
    // idle: frames drawn in 2 s while playing
    const events = [];
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.start', { categories: 'disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
    await wait(2000); await cdp.send('Tracing.end'); await done; cdp.removeAllListeners('Tracing.dataCollected');
    const frames = events.filter((e) => e.name === 'DrawFrame').length;
    console.log('   frames drawn in 2 s idle (playing):', frames);
    expect(frames < 30, `${frames} frames in 2 s idle`);
  });

  // --- Playback ---------------------------------------------------------------------------
  await step('song end: the next one plays', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    const first = await nowTitle();
    await p.evaluate(() => { const a = [...document.querySelectorAll('audio')][0]; });
    // jump to the end: the loop goes round = its end
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(500);
    const r = await p.locator('.fixed.inset-0.z-30 [role="slider"]').boundingBox();
    await drag(r.x + 10, r.y + r.height / 2, r.width - 12, 0, 6, 16); await wait(5000);
    expect((await nowTitle()) !== first, 'still ' + first);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(400);
  });

  await step('app start: the position line is right before play, and a drag sets where it starts', async () => {
    await p.goto(BASE + '/playlist/2'); await wait(1500); await playFirst();
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(500);
    const r = await p.locator('.fixed.inset-0.z-30 [role="slider"]').boundingBox();
    await drag(r.x + r.width * 0.3, r.y + r.height / 2, r.width * 0.2, 0, 4, 16); await wait(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Pause"]'); await wait(5500);
    await p.reload(); await wait(2500);
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(600);
    const slider = p.locator('.fixed.inset-0.z-30 [role="slider"]');
    const now = Number(await slider.getAttribute('aria-valuenow'));
    const max = Number(await slider.getAttribute('aria-valuemax'));
    expect(max > 0 && now >= 8 && now <= 12, `line at ${now} of ${max}`);
    const box = await slider.boundingBox();
    await drag(box.x + box.width * 0.5, box.y + box.height / 2, box.width * 0.25, 0, 4, 16); await wait(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Play"]'); await wait(1200);
    const playing = Number(await slider.getAttribute('aria-valuenow'));
    expect(playing >= 14, 'started at ' + playing);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(400);
  });

  await step('no page errors', async () => expect(!errors.length, errors.slice(0, 3).join(' | ')));
  await b.close();
  const failed = results.filter(([r]) => r === 'FAIL').length;
  console.log(`${failed} failed of ${results.length}`);
  process.exitCode = failed ? 1 : 0;
})();
