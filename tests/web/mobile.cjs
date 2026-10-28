// The phone suite: gestures (and cancelling them), the keyboard, a long session (leaks), a
// performance budget on a slowed-down CPU, offline, a breaking stream. Installed-app mode.
const { devices } = require('playwright');
const { setup, login, launch, touchInput, isChromium, BROWSER, ops } = require('./harness.cjs');
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
  // (when each hitsound is set to play, ahead of now; and how many are called off)
  await ctx.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__audio = this; (window.__elements ||= new Set()).add(this); return play.apply(this, a); };
    // (the songs' sound through Web Audio: each element's level and fade, as routed)
    const route = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (element) {
      const source = route.call(this, element);
      window.__routing = { element, gains: [] };
      (window.__routes ||= []).push(window.__routing);
      return source;
    };
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this);
      if (window.__routing && window.__routing.gains.length < 2) window.__routing.gains.push(node);
      return node;
    };
    // (Safari's audio session; the other engines have none)
    if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' } });
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      window.__hitContext = this;
      const start = source.start.bind(source);
      const stop = source.stop.bind(source);
      // (and where in the song it lands, by the song's own time now)
      source.start = (when = 0, ...rest) => {
        const lead = when - this.currentTime;
        const audio = window.__audio;
        (window.__hitLeads ||= []).push({ lead, song: audio ? audio.currentTime * 1000 + lead * 1000 * audio.playbackRate : null });
        (window.__hitPending ||= []).push({ source, when, context: this });
        return start(when, ...rest);
      };
      source.stop = (...a) => { source.__stopped = true; window.__hitStopped = (window.__hitStopped || 0) + 1; return stop(...a); };
      return source;
    };
  });
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
    // (a flick: fast; with the harness' own delay per move, 4 moves of 30 px at 10 ms came out
    // right at the threshold, 0.45 px/ms, a finger's flick is about twice that)
    await drag(200, 150, 0, 120, 3, 0); await wait(600);
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

  await step('hitsounds: on the beat, also with the screen locked (seconds ahead) and after their audio slept; stop on pause', async () => {
    await p.goto(BASE + '/settings'); await wait(1200);
    const toggle = p.locator('button[role="switch"]:has-text("Play the hitsounds")');
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await wait(300);
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst(); await wait(2500);
    const all = () => p.evaluate(() => { const l = window.__hitLeads || []; window.__hitLeads = []; return l; });
    const leads = async () => (await all()).map((h) => h.lead);
    // (the mock's notes are every 500 ms: where each lands in the song, off the beat by how much)
    const offBeat = (hits) => Math.max(0, ...hits.filter((h) => h.song != null).map((h) => { const r = ((h.song % 500) + 500) % 500; return Math.min(r, 500 - r); }));
    await all();
    await wait(1200);
    const shownHits = await all();
    const shown = shownHits.map((h) => h.lead);
    expect(shown.length > 0, 'no hitsounds while shown');
    expect(Math.max(...shown) < 0.5, 'shown: scheduled too far ahead ' + Math.max(...shown));
    expect(offBeat(shownHits) < 60, 'shown: off the beat by ' + Math.round(offBeat(shownHits)) + ' ms');
    expect(await p.evaluate(() => navigator.audioSession.type) === 'playback', 'not a player\'s audio session');
    // the screen locked
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await wait(1500);
    const locked = await leads();
    expect(locked.length > 0, 'no hitsounds with the screen locked');
    expect(Math.max(...locked) > 3, 'locked: not scheduled ahead (' + Math.max(...locked) + ' s)');
    const running = await p.evaluate(() => window.__hitContext?.state);
    expect(running === 'running', 'the hitsounds\' audio is ' + running);
    // their audio put to sleep for a moment (as iOS may), the song going on: back on the beat
    // (and not woken by the app meanwhile: iOS doesn't let it in the background)
    await p.evaluate(() => { const c = window.__hitContext; c.__resume = c.resume; c.resume = () => Promise.resolve(); return c.suspend(); }); await wait(1250);
    await p.evaluate(() => { const c = window.__hitContext; c.resume = c.__resume; return c.resume(); }); await all(); await wait(1200);
    const after = await all();
    expect(after.length > 0, 'no hitsounds after their audio slept');
    expect(offBeat(after) < 60, 'after sleeping: off the beat by ' + Math.round(offBeat(after)) + ' ms');
    // and the ones still to come (scheduled before it slept, too): where they'll land now
    const pending = await p.evaluate(() => {
      const audio = window.__audio;
      return (window.__hitPending || []).filter((h) => !h.source.__stopped && h.when > h.context.currentTime + 0.05)
        .map((h) => ({ song: audio.currentTime * 1000 + (h.when - h.context.currentTime) * 1000 * audio.playbackRate }));
    });
    expect(pending.length > 0, 'nothing scheduled ahead after sleeping');
    expect(offBeat(pending) < 60, 'scheduled before sleeping: off the beat by ' + Math.round(offBeat(pending)) + ' ms');
    // paused from the lock screen: what's scheduled is called off
    await p.locator('.dock button[aria-label="Pause"]').first().click(); await wait(400);
    const stopped = await p.evaluate(() => window.__hitStopped || 0);
    expect(stopped > 0, 'nothing called off on pause');
    await p.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await p.goto(BASE + '/settings'); await wait(1000);
    await p.locator('button[role="switch"]:has-text("Play the hitsounds")').click(); await wait(300);
  });

  await step("hitsounds: from the hardest osu!standard difficulty (as the desktop), another can be chosen, and play", async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(600);
    await p.click('.fixed.inset-0.z-30 button[aria-label^="Speed mod"]'); await wait(500);
    const sheet = p.locator('.fixed.inset-0.z-40');
    const toggle = sheet.locator('button[role="switch"]:has-text("Play the hitsounds")');
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await sheet.locator('button:has-text("Easy")').waitFor();
    const names = await sheet.locator('button[aria-pressed]:has(span.rounded-full)').allTextContents();
    expect(names.length === 3 && /Easy/.test(names[0]) && /Insane/.test(names[1]) && /Expert/.test(names[2]), 'difficulties: ' + names.join(' | '));
    expect((await sheet.locator('button:has-text("Expert")').getAttribute('aria-pressed')) === 'true', "the hardest isn't the one playing");
    const setId = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('stosufy-web-player') || '{}'); return s.songs?.[s.index]?.id; });
    const known = await p.evaluate(() => JSON.parse(localStorage.getItem('stosufy-web-hardest') || '{}'));
    expect(known[setId] === String(97000 + setId), 'hardest kept: ' + JSON.stringify(known));
    ops.length = 0;
    await sheet.locator('button:has-text("Easy")').click(); await wait(1200);
    expect((await sheet.locator('button:has-text("Easy")').getAttribute('aria-pressed')) === 'true', 'Easy not chosen');
    expect(ops.includes('osufile:' + (99000 + setId)), "Easy's beatmap not loaded: " + ops.filter((o) => o.startsWith('osufile')).join(','));
    // (kept: the sheet again)
    await p.mouse.click(200, 60); await wait(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label^="Speed mod"]'); await wait(500);
    expect((await sheet.locator('button:has-text("Easy")').getAttribute('aria-pressed')) === 'true', 'the choice was not kept');
    await sheet.locator('button:has-text("Expert")').click(); await wait(300);
    expect((await sheet.locator('button:has-text("Expert")').getAttribute('aria-pressed')) === 'true', 'back to the hardest');
    await toggle.click(); await wait(300);
    await p.mouse.click(200, 60); await wait(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(400);
  });

  await step("beatmap page: a difficulty tapped is the one whose hitsounds play (the song's only)", async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    const setId = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('stosufy-web-player') || '{}'); return s.songs?.[s.index]?.id; });
    await p.goto(BASE + '/map/' + setId); await wait(1500);
    const row = (name) => p.locator(`main li button:has-text("${name}")`);
    expect((await row('Expert').getAttribute('aria-pressed')) === 'true', "the hardest isn't marked");
    expect(await row('Taiko hard').isDisabled(), 'a taiko one can be chosen');
    expect(await row('Other song').isDisabled(), "another song's can be chosen");
    await row('Easy').click(); await wait(300);
    expect((await row('Easy').getAttribute('aria-pressed')) === 'true', 'Easy not chosen');
    expect((await row('Expert').getAttribute('aria-pressed')) === 'false', 'two chosen');
    await row('Expert').click(); await wait(300);
    expect((await row('Expert').getAttribute('aria-pressed')) === 'true', 'back to the hardest');
  });

  await step('up next: a song moved by its handle, the one playing stays', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    const order = () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('stosufy-web-player') || '{}'); return { titles: (s.songs || []).map((x) => x.title), index: s.index }; });
    const before = await order();
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(600);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Up next"]'); await wait(500);
    const handles = p.locator('.fixed.inset-0.z-30 [data-handle]');
    const a = await handles.nth(0).boundingBox();
    const c = await handles.nth(2).boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
    for (let i = 1; i <= 8; i++) { await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((c.y - a.y) * i) / 8); await wait(30); }
    await p.mouse.up(); await wait(500);
    const after = await order();
    const i = before.index;
    expect(after.index === i && after.titles[i] === before.titles[i], 'the song playing moved');
    expect(after.titles[i + 3] === before.titles[i + 1] && after.titles[i + 1] === before.titles[i + 2], 'not moved: ' + after.titles.slice(i, i + 4).join(' | '));
    expect(after.titles.length === before.titles.length, 'songs lost');
    await p.click('.fixed.inset-0.z-30 button[aria-label="Up next"]'); await wait(300);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(400);
  });

  await step('a song swiped to the right goes to the queue; a short or an up-and-down one does not', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    const count = () => p.evaluate(() => (JSON.parse(localStorage.getItem('stosufy-web-player') || '{}').songs || []).length);
    // (in the middle of the screen: not under the tab bar)
    await p.locator('main ol > li').nth(4).evaluate((li) => li.scrollIntoView({ block: 'center' })); await wait(300);
    const row = await p.locator('main ol > li').nth(4).boundingBox();
    const y = row.y + row.height / 2;
    const n = await count();
    await drag(120, y, 60, 0, 6, 16); await wait(400);
    expect((await count()) === n, 'a short swipe added it');
    await drag(120, y, 10, -150, 8, 16); await wait(400);
    expect((await count()) === n, 'scrolling added it');
    // (the up-and-down one scrolled the page: the row in the middle again)
    await p.locator('main ol > li').nth(4).evaluate((li) => li.scrollIntoView({ block: 'center' })); await wait(300);
    const box = await p.locator('main ol > li').nth(4).boundingBox();
    const title = (await p.locator('main ol > li').nth(4).locator('span.font-semibold').first().textContent()).trim();
    await drag(120, box.y + box.height / 2, 170, 0, 10, 16); await wait(500);
    expect((await count()) === n + 1, 'not added: ' + n + ' → ' + (await count()));
    const last = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('stosufy-web-player')); return s.songs[s.songs.length - 1].title; });
    expect(last === title, 'added ' + last + ', not ' + title);
    expect(await p.locator('text=Added to the queue').count(), 'no word of it');
    expect(path() === '/playlist/2', 'the swipe went somewhere: ' + path());
    // (the row back in place, nothing left behind it)
    expect(!(await p.locator('main ol > li').nth(4).evaluate((li) => [...li.children].some((c) => c.style.transform))), 'the row stayed moved');
  });

  await step('the Nightcore beat plays on with the screen locked (seconds ahead), called off on pause', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst();
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(600);
    await p.click('.fixed.inset-0.z-30 button[aria-label^="Speed mod"]'); await wait(500);
    await p.locator('.fixed.inset-0.z-40 button:has-text("NC")').click(); await wait(300);
    await p.mouse.click(200, 60); await wait(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(1500);
    await p.evaluate(() => { window.__hitLeads = []; window.__disconnects = 0; const d = GainNode.prototype.disconnect; GainNode.prototype.disconnect = function (...a) { window.__disconnects++; return d.apply(this, a); }; });
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await wait(1500);
    const leads = (await p.evaluate(() => window.__hitLeads)).map((h) => h.lead);
    expect(leads.length > 0, 'no beat with the screen locked');
    expect(Math.max(...leads) > 3, 'not scheduled ahead: ' + Math.max(...leads));
    await p.locator('.dock button[aria-label="Pause"]').first().click(); await wait(400);
    expect((await p.evaluate(() => window.__disconnects)) > 0, 'the beat scheduled ahead was not called off on pause');
    await p.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await p.locator('button[aria-label="Open the player"]').first().click(); await wait(600);
    await p.click('.fixed.inset-0.z-30 button[aria-label^="Speed mod"]'); await wait(500);
    await p.locator('.fixed.inset-0.z-40 button:has-text("NM")').click(); await wait(300);
    await p.mouse.click(200, 60); await wait(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await wait(400);
  });

  await step('same loudness: the song through Web Audio, at the usual level first, then its own; off: as it is', async () => {
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst(); await wait(800);
    const level = () => p.evaluate(() => {
      const r = (window.__routes || []).find((x) => x.element === window.__audio);
      return r ? Math.round(r.gains[0].gain.value * 1000) / 1000 : null;
    });
    const start = await level();
    expect(start != null, 'the song isn\'t routed: ' + (await p.evaluate(() => JSON.parse(localStorage.getItem('stosufy-web-log') || '[]').slice(-4).join(' | '))));
    expect(Math.abs(start - 0.562) < 0.05, 'not at the usual level at first: ' + start);
    // (the mock's tone is quiet, -24 LUFS: brought up as far as it goes, to 1)
    await wait(9000);
    const own = await level();
    expect(own > 0.9, 'not at its own level: ' + own);
    // (the settings in the app: the song plays on)
    await tab('Home'); if (path() !== '/') await tab('Home');
    await p.click('main a[aria-label="Settings"]'); await wait(1000);
    const toggle = p.locator('button[role="switch"]:has-text("Same loudness")');
    expect((await toggle.getAttribute('aria-checked')) === 'true', 'off by default');
    await toggle.click(); await wait(800);
    expect((await level()) === 1, 'off: not as it is');
    await toggle.click(); await wait(300);
  });

  await step('crossfade: the next song comes in on the other element while this one fades out; turned down, the next one at the end', async () => {
    await p.goto(BASE + '/settings'); await wait(1000);
    await p.locator('label:has-text("Crossfade") input[type="range"]').evaluate((input) => { input.value = '3'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(300);
    await tab('Library'); await p.click('text=Chill'); await wait(900); await playFirst(); await wait(1500);
    const state = () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('stosufy-web-player') || '{}'); return { index: s.index, title: s.songs?.[s.index]?.title }; });
    const before = await state();
    const first = await p.evaluate(() => { const a = window.__audio; a.currentTime = a.duration - 4.5; return a.duration; });
    expect(first > 10, 'duration ' + first);
    await wait(2600);
    const during = await p.evaluate(() => [...window.__elements].filter((e) => !e.paused && e.src).length);
    const after = await state();
    expect(after.index === before.index + 1, 'not on to the next song: ' + JSON.stringify([before, after]));
    expect(during === 2, 'both songs not playing together: ' + during);
    const log = await p.evaluate(() => JSON.parse(localStorage.getItem('stosufy-web-log') || '[]').join(' | '));
    expect(/crossfade into/.test(log), 'no crossfade in the log');
    await wait(3500);
    const playingNow = await p.evaluate(() => [...window.__elements].filter((e) => !e.paused && e.src).length);
    expect(playingNow === 1, 'the old song still plays: ' + playingNow);
    const title = await nowTitle();
    expect(title === after.title, 'the song shown is ' + title);
    // Turned down (iOS, with the screen locked, may not let the other element play): the next
    // song when this one ends, as without crossfade
    const at = await state();
    await p.evaluate(() => {
      window.__main = window.__audio;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...a) {
        if (this !== window.__main) return Promise.reject(new DOMException('not now', 'NotAllowedError'));
        return play.apply(this, a);
      };
      window.__restorePlay = () => (HTMLMediaElement.prototype.play = play);
      const a = window.__audio; a.currentTime = a.duration - 4.5;
    });
    await wait(6500);
    const then = await state();
    await p.evaluate(() => window.__restorePlay());
    expect(then.index === at.index + 1, 'not on to the next song after a turned-down crossfade: ' + JSON.stringify([at, then]));
    const log2 = await p.evaluate(() => JSON.parse(localStorage.getItem('stosufy-web-log') || '[]').join(' | '));
    expect(/crossfade turned down/.test(log2), 'not turned down');
    expect(await p.evaluate(() => !window.__main.paused), 'stopped instead of going on');
    await p.goto(BASE + '/settings'); await wait(1000);
    await p.locator('label:has-text("Crossfade") input[type="range"]').evaluate((input) => { input.value = '0'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(300);
  });

  await step("a touch at the edge is held from iOS' swipe, a tap there still taps", async () => {
    await p.goto(BASE + '/'); await wait(1200);
    await tab('Library'); await p.click('text=Chill'); await wait(900);
    await p.evaluate(() => window.addEventListener('touchstart', (e) => (window.__held = e.defaultPrevented)));
    const held = async (x) => { await touch('touchStart', x, 500); await touch('touchEnd'); await wait(100); return p.evaluate(() => window.__held); };
    expect(await held(6), 'left edge not held');
    expect(!(await held(200)), 'middle held');
    expect(path() === '/playlist/2', 'a touch at the edge went somewhere: ' + path());
    const back = await p.locator('main header a[aria-label="Back"]').first().boundingBox();
    expect(back && back.x < 24, 'no back button at the edge: ' + JSON.stringify(back));
    await touch('touchStart', Math.max(back.x + 4, 6), back.y + back.height / 2); await touch('touchEnd'); await wait(900);
    expect(path() === '/library', 'tap at the edge: at ' + path());
  });

  await step("the bar's play button at the top shows pause while the playlist plays, and pauses it", async () => {
    await p.goto(BASE + '/playlist/2'); await wait(1500);
    await p.evaluate(() => window.scrollTo(0, 900)); await wait(600);
    const bar = p.locator('main div.sticky.top-0 button[aria-label="Play"], main div.sticky.top-0 button[aria-label="Pause"]').first();
    expect((await bar.getAttribute('aria-label')) === 'Play', 'not play at first');
    await bar.click(); await wait(1000);
    expect((await bar.getAttribute('aria-label')) === 'Pause', 'still play while it plays');
    expect(await p.evaluate(() => !window.__audio.paused), 'not playing');
    await bar.click(); await wait(600);
    expect((await bar.getAttribute('aria-label')) === 'Play', 'not play again after pausing');
    expect(await p.evaluate(() => window.__audio.paused), 'not paused');
  });

  await step('moving triangles: still unless turned on (this phone only)', async () => {
    const state = async () => { await p.goto(BASE + '/playlist/2'); await wait(1200); return p.evaluate(() => getComputedStyle(document.querySelector('.animate-triangle')).animationPlayState); };
    const flip = async () => { await p.goto(BASE + '/settings'); await wait(1000); await p.locator('button[role="switch"]:has-text("Moving triangles")').click(); await wait(200); };
    expect((await state()) === 'paused', 'moving without being turned on');
    await flip();
    expect((await state()) === 'running', 'not moving when turned on (and kept)');
    await flip();
    expect((await state()) === 'paused', 'still moving when turned off');
  });

  await step("after going around many pages, back to a tab's start still has it under the finger", async () => {
    await p.goto(BASE + '/'); await wait(1200);
    await tab('Search');
    // (a search of before: cleared, the start of Search shows the community link)
    const clear = p.locator('main button[aria-label="Clear"]');
    if (await clear.count()) { await clear.first().click(); await wait(400); }
    await p.click('main a[href$="/community"]'); await wait(900);
    // (more pages than are kept, in another tab)
    await tab('Library');
    for (let i = 0; i < 7; i++) {
      await p.click(`text=${['Chill', 'Gaming', 'Anime openings', 'Liked Songs'][i % 4]}`); await wait(600);
      await p.locator('main ol > li').first().locator('button[aria-label^="More"]').click(); await wait(250);
      await p.click('text=Go to beatmap'); await wait(600);
      await tab('Library'); await tab('Library');
    }
    await tab('Search');
    expect(path() === '/community', 'not back at the community page: ' + path());
    await touch('touchStart', 8, 400); for (let i = 1; i <= 5; i++) { await touch('touchMove', 8 + i * 30, 400); await wait(16); }
    const under = await p.evaluate(() => [...document.querySelectorAll('body > .fixed.inset-0.overflow-hidden.pointer-events-none')].filter((l) => l.firstElementChild?.firstElementChild).length);
    await touch('touchEnd'); await wait(900);
    expect(under === 1, 'no picture of Search under the finger');
    expect(path() === '/search', 'at ' + path());
  });

  await step("iOS going back during the app's swipe: one page back, not two; the app's swipe stays", async () => {
    await p.goto(BASE + '/'); await wait(1200);
    await tab('Library'); await p.click('text=Chill'); await wait(900);
    await p.locator('main ol > li').first().locator('button[aria-label^="More"]').click(); await wait(300);
    await p.click('text=Go to beatmap'); await wait(1200);
    // the finger at the edge, and iOS going back itself as it's let go
    await touch('touchStart', 8, 400); for (let i = 1; i <= 8; i++) { await touch('touchMove', 8 + i * 30, 400); await wait(16); }
    await p.evaluate(() => history.back());
    await touch('touchEnd');
    await wait(1200);
    expect(path() === '/playlist/2', 'at ' + path() + ' (want one page back: /playlist/2)');
    expect((await underlays()) === 0 && !(await mainMoved()), 'left something behind');
    // (and not stepped aside for good: the app's swipe and the edge's hold go on)
    await drag(8, 400, 250, 0); await wait(900);
    expect(path() === '/library', "the app's swipe stopped working: " + path());
    expect(await p.evaluate(() => !localStorage.getItem('stosufy-web-native-back-2')), 'something kept');
  });

  await step('no page errors', async () => expect(!errors.length, errors.slice(0, 3).join(' | ')));
  await b.close();
  const failed = results.filter(([r]) => r === 'FAIL').length;
  console.log(`${failed} failed of ${results.length}`);
  process.exitCode = failed ? 1 : 0;
})();
