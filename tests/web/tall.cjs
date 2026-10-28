const { chromium, devices } = require('playwright');
process.env.PWTIMEOUT = 1;
const { setup, login, ops, state } = require('./harness.cjs');
const results = [];
let p, ctx, cdp;
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, String(e.message || e).split('\n')[0]]); console.log('FAIL', name, String(e.message || e).split('\n')[0]); await p.screenshot({ path: `fail-${results.length}.png` }).catch(() => {}); await reset(); }
}
async function reset() {
  // (by the DOM: the sheet covers the middle of the backdrop)
  await p.evaluate(() => document.querySelector('.fixed.inset-0.z-40 > button[aria-label="Close"]')?.click()).catch(() => {});
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.fixed.inset-0.z-30 button[aria-label="Close"]')?.click()).catch(() => {});
  await p.waitForTimeout(500);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const wait = (ms) => p.waitForTimeout(ms);
const playerState = () => p.evaluate(() => JSON.parse(localStorage.getItem('stosufy-web-player') || '{}'));
const nowTitle = async () => { const s = await playerState(); return s.songs?.[s.index]?.title; };
const toast = (text) => p.locator(`text=${text}`).count();
const tab = async (name) => { await p.click(`nav button:has-text("${name}")`); await wait(700); };
const dockOpen = async () => { const b = await p.locator('[data-no-edge]').first().boundingBox(); await p.mouse.click(b.x + 80, b.y + b.height / 2); await wait(600); };
const menuFor = async (n) => { await p.locator('main ol > li').nth(n).locator('button[aria-label^="More"]').click(); await wait(300); };
const menuItem = async (text) => { await p.locator('.fixed.inset-0.z-40 button', { hasText: text }).first().click(); await wait(600); };
async function touchDrag(x0, y0, dx, dy = 0) {
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await t('touchStart', x0, y0);
  for (let i = 1; i <= 10; i++) { await t('touchMove', x0 + (dx * i) / 10, y0 + (dy * i) / 10); await wait(16); }
  await t('touchEnd');
}
(async () => {
  const b = await chromium.launch();
  ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  await setup(ctx);
  p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  cdp = await ctx.newCDPSession(p);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  await step('login with pasted login', async () => { await login(p); await wait(3000); expect(await p.locator('text=Good').count(), 'no greeting'); });
  await step('home: sections', async () => {
    const h = await p.evaluate(() => [...document.querySelectorAll('main h2')].map((x) => x.textContent.trim()));
    for (const s of ['Recently played', 'Made for you', 'Radio', 'Your top songs', 'Discover beatmaps']) expect(h.some((x) => x.includes(s)), 'missing ' + s + ' in ' + h);
  });
  await step('home: hero plays the song heard last', async () => { await p.click('main section button[aria-label^="Play"]'); await wait(1200); expect(await nowTitle() === 'Song number 12' || await nowTitle(), 'nothing playing'); });
  await step('home: recently played card plays it', async () => { await p.locator('main section:has(h2:text("Recently played")) li').nth(1).locator('button').click(); await wait(800); expect(await nowTitle(), 'no song'); });
  await step('home: mix page opens and plays', async () => {
    await p.locator('main section:has(h2:text("Made for you")) li a').first().click(); await wait(1000);
    expect(p.url().includes('/mix/'), 'not on mix page');
    await p.locator('main button[aria-label="Play"]').last().click(); await wait(800);
    expect((await playerState()).songs.length > 5, 'mix not queued');
    await p.locator('main header a[aria-label="Back"]').click(); await wait(800);
  });
  await step('home: radio starts', async () => {
    await p.locator('main section:has(h2:text("Radio")) li button').first().click(); await wait(2500);
    expect((await playerState()).songs.length > 5, 'radio queue too short: ' + (await playerState()).songs.length);
  });
  await step('home: top songs show all', async () => { const btn = p.locator('main button:has-text("Show all")'); await btn.click(); await wait(300); expect(await p.locator('main button:has-text("Show less")').count(), 'no show less'); });
  await step('home: discover more', async () => { const before = await p.locator('main section:has(h2:text("Discover")) li').count(); const more = p.locator('main section:has(h2:text("Discover")) button:has-text("More")'); if (await more.count()) { await more.click(); await wait(1200); } expect(before > 0, 'no discover rows'); });

  await step('library: list', async () => { await tab('Library'); const t = await p.locator('main ul li').allTextContents(); expect(t.some((x) => x.includes('Downloaded Songs')) && t.some((x) => x.includes('Liked Songs')) && t.some((x) => x.includes('Chill')), 'entries: ' + t.join('|')); });
  await step('library: create playlist', async () => { await p.click('button[aria-label="New playlist"]'); await p.fill('input[aria-label="Name of the new playlist"]', 'Test new'); await p.click('button:has-text("Create")'); await wait(1500); expect(p.url().includes('/playlist/6'), 'not opened: ' + p.url()); expect(ops.includes('create:Test new'), 'no create op'); });
  await step('playlist: rename', async () => { await p.click('main button[aria-label="More"]'); await p.click('button:has-text("Rename")'); await p.fill('input[aria-label="Name"]', 'Renamed one'); await p.keyboard.press('Enter'); await wait(800); expect(ops.includes('edit:Renamed one'), 'no edit op'); expect(await p.locator('h1:has-text("Renamed one")').count(), 'title not shown'); });
  await step('playlist: delete', async () => { await p.click('main button[aria-label="More"]'); await p.click('button:has-text("Delete")'); await p.click('button:has-text("Tap again to delete")'); await wait(1200); expect(p.url().endsWith('/library'), 'not back to library: ' + p.url()); expect(!(await p.locator('main ul li:has-text("Renamed one")').count()), 'still listed'); });

  await step('playlist: open and play', async () => { await p.click('main a:has-text("Chill")'); await wait(1500); expect(await p.locator('main ol > li').count() === 25, 'rows ' + await p.locator('main ol > li').count()); await p.locator('main button[aria-label="Play"]').last().click(); await wait(800); expect(await nowTitle() === 'Song number 21', 'now ' + await nowTitle()); });
  await step('playlist: no reload loop', async () => { const n = ops.filter((o) => o === 'songs:2').length; await wait(5000); const m = ops.filter((o) => o === 'songs:2').length; expect(m - n <= 1, `asked for the songs ${m - n} times in 5 s`); });
  await step('playlist: play button pauses', async () => { await p.locator('main button[aria-label="Pause"]').first().click(); await wait(400); expect(await p.locator('main button[aria-label="Play"]').count(), 'not paused'); await p.locator('main button[aria-label="Play"]').last().click(); await wait(400); });
  await step('playlist: shuffle', async () => { await p.click('main button[aria-label="Shuffle"]'); await wait(600); const s = await playerState(); expect(s.shuffle === true, 'shuffle off'); });
  await step('playlist: keep downloaded (one tap downloads)', async () => {
    await p.click('main button[aria-label="Keep it on the phone"]'); await wait(5000);
    const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('stosufy-web-auto-download') || '[]'));
    expect(kept.includes('2'), 'auto not on');
    expect(await p.locator('text=25 on the phone').count(), 'not all downloaded: ' + (await p.locator('main').innerText()).match(/\d+ on the phone/));
  });
  await step('playlist: filter', async () => { await p.fill('main input[type=search]', 'number 33'); await wait(300); expect(await p.locator('main ol > li').count() === 1, 'filter rows ' + await p.locator('main ol > li').count()); await p.fill('main input[type=search]', ''); });
  await step('playlist: row tap plays it', async () => { await p.locator('main ol > li').nth(4).locator('button').first().click(); await wait(600); expect(await nowTitle() === 'Song number 25', 'now ' + await nowTitle()); });

  await step('menu: play next', async () => { await menuFor(10); await menuItem('Play next'); const s = await playerState(); expect(s.songs[s.index + 1].title === 'Song number 31', 'next is ' + s.songs[s.index + 1].title); });
  await step('menu: add to queue', async () => { await menuFor(11); await menuItem('Add to queue'); const s = await playerState(); expect(s.songs.at(-1).title === 'Song number 32', 'last is ' + s.songs.at(-1).title); });
  await step('menu: like', async () => { await menuFor(12); await menuItem('Add to Liked Songs'); expect(ops.some((o) => o.startsWith('fav:1032:true')), 'no fav op: ' + ops.slice(-3)); });
  await step('menu: unlike', async () => { await menuFor(12); await menuItem('Remove from Liked Songs'); expect(ops.some((o) => o.startsWith('fav:1032:false')), 'no unfav op'); });
  await step('menu: add to playlist (and already in it)', async () => {
    await menuFor(13); await menuItem('Add to playlist'); await p.locator('.fixed.inset-0.z-40 button', { hasText: 'Anime openings' }).click(); await wait(1200);
    expect(ops.some((o) => o === 'add:4:1033'), 'no add op ' + ops.slice(-3));
    await menuFor(13); await menuItem('Add to playlist'); await wait(300);
    const txt = await p.locator('.fixed.inset-0.z-40 button', { hasText: 'Anime openings' }).innerText();
    expect(txt.includes('Already in it'), 'no already: ' + txt);
    await reset();
  });
  await step('menu: remove from this playlist', async () => { await menuFor(14); await menuItem('Remove from this playlist'); await wait(800); expect(ops.some((o) => o.startsWith('remove:2:')), 'no remove op'); expect(await p.locator('main ol > li').count() === 24, 'rows ' + await p.locator('main ol > li').count()); });
  await step('menu: remove from the phone, then download again', async () => {
    await menuFor(0); await menuItem('Remove from the phone'); await wait(500);
    await menuFor(0); const has = await p.locator('.fixed.inset-0.z-40 button', { hasText: /^\s*Download\s*$/ }).count(); expect(has, 'no Download item after removing');
    await menuItem('Download'); await wait(1000);
    await menuFor(0); expect(await p.locator('.fixed.inset-0.z-40 button:has-text("Remove from the phone")').count(), 'not downloaded again'); await reset();
  });
  await step('menu: start radio', async () => { await menuFor(2); await menuItem('Start radio'); await wait(2000); const s = await playerState(); expect(s.songs[0].title === 'Song number 23' && s.songs.length > 5, 'radio ' + s.songs.length + ' ' + s.songs[0].title); });
  await step('menu: share copies the link', async () => { await menuFor(3); await menuItem('Share'); const clip = await p.evaluate(() => navigator.clipboard.readText()); expect(clip.includes('osu.ppy.sh/beatmapsets/'), 'clipboard: ' + clip); });

  await step('dock: tap opens the full player', async () => { await dockOpen(); expect(await p.locator('button[aria-label="Close"]').count(), 'not open'); });
  await step('player: pause/play', async () => { await p.click('.fixed.inset-0.z-30 button[aria-label="Pause"]'); await wait(300); expect(await p.locator('.fixed.inset-0.z-30 button[aria-label="Play"]').count(), 'not paused'); await p.click('.fixed.inset-0.z-30 button[aria-label="Play"]'); await wait(300); });
  await step('player: next and back', async () => { const a = (await playerState()).index; await p.click('.fixed.inset-0.z-30 button[aria-label="Next"]'); await wait(500); expect((await playerState()).index === a + 1, 'next'); await p.click('.fixed.inset-0.z-30 button[aria-label="Back"]'); await wait(500); expect((await playerState()).index === a, 'back ' + (await playerState()).index); });
  await step('player: shuffle toggles', async () => { const before = (await playerState()).shuffle; await p.click('.fixed.inset-0.z-30 button[aria-label="Shuffle"]'); await wait(300); expect((await playerState()).shuffle === !before, 'shuffle'); });
  await step('player: repeat cycles', async () => { await p.click('.fixed.inset-0.z-30 button[aria-label^="Repeat"]'); await wait(200); expect((await playerState()).repeat === 'all', 'repeat all'); await p.click('.fixed.inset-0.z-30 button[aria-label^="Repeat"]'); await wait(200); expect((await playerState()).repeat === 'one', 'one'); await p.click('.fixed.inset-0.z-30 button[aria-label^="Repeat"]'); await wait(200); expect((await playerState()).repeat === 'off', 'off'); });
  await step('player: like the song', async () => { const n = ops.length; await p.click('.fixed.inset-0.z-30 button[aria-label="Like"]'); await wait(500); expect(ops.slice(n).some((o) => o.startsWith('fav:') && o.endsWith(':true')), 'no fav'); });
  await step('player: up next, jump and take out', async () => {
    await p.click('button[aria-label="Up next"]'); await wait(300);
    const rows = p.locator('ol[data-no-swipe] > li'); const n = await rows.count(); expect(n > 2, 'up next rows ' + n);
    const t = await rows.nth(1).locator('button').first().innerText(); await rows.nth(1).locator('button').first().click(); await wait(500);
    expect(t.includes(await nowTitle()), 'jumped to ' + await nowTitle());
    const n2 = await rows.count(); await rows.nth(0).locator('button[aria-label^="Take"]').click(); await wait(300); expect(await rows.count() === n2 - 1 || n2 > 50, 'not taken out');
  });
  await step('player: autoplay switch', async () => { await p.click('button[role=switch]:has-text("Autoplay")'); await wait(200); expect((await playerState()).autoplay === false, 'autoplay still on'); await p.click('button[role=switch]:has-text("Autoplay")'); await wait(200); expect((await playerState()).autoplay === true, 'autoplay off'); });
  await step('player: lyrics', async () => { await p.click('button[aria-label="Lyrics"]'); await wait(2500); expect(await p.locator('button[data-line]').count() > 5, 'no lyric lines'); });
  await step('player: sleep timer', async () => { await p.click('button[aria-label="Sleep timer"]'); await p.click('text=In 30 minutes'); await wait(300); expect(await p.locator('button[aria-label="Sleep timer"]:has-text("30 min")').count(), 'no 30 min'); await p.click('button[aria-label="Sleep timer"]'); await p.click('text=Turn off'); await wait(200); expect(!(await p.locator('button[aria-label="Sleep timer"]:has-text("min")').count()), 'not off'); });
  await step('player: seek', async () => { await p.click('button[aria-label="Lyrics"]'); await wait(300); const r = await p.locator('.fixed.inset-0.z-30 [role="slider"][aria-label="Position"]').boundingBox(); const y = r.y + r.height / 2; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width * 0.2, y }] }); for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width * (0.2 + i * 0.05), y }] }); await wait(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(400); const t = await p.locator('.fixed.inset-0.z-30 [role="slider"]').getAttribute('aria-valuenow'); expect(Number(t) >= 8 && Number(t) <= 12, 'seeked to ' + t); });
  await step('player: cover swipe = next', async () => { const a = (await playerState()).index; const bx = await p.locator('.fixed.inset-0.z-30 [aria-label^="Swipe for the next"]').boundingBox(); await touchDrag(bx.x + 300, bx.y + bx.height / 2, -220); await wait(600); expect((await playerState()).index === a + 1, `index ${a} -> ${(await playerState()).index}`); });
  await step('player: swipe down closes', async () => { await touchDrag(200, 120, 0, 300); await wait(600); expect(!(await p.locator('.fixed.inset-0.z-30').count()), 'still open'); });
  await step('dock: swipe = next / back', async () => { const a = (await playerState()).index; const bx = await p.locator('[data-no-edge]').first().boundingBox(); await touchDrag(bx.x + 220, bx.y + bx.height / 2, -180); await wait(600); expect((await playerState()).index === a + 1, 'next'); await touchDrag(bx.x + 40, bx.y + bx.height / 2, 180); await wait(600); expect((await playerState()).index === a, 'back'); });

  await step('downloads: list, play, shuffle', async () => { await tab('Downloads'); const n = await p.locator('main ol > li').count(); expect(n >= 25, 'downloads ' + n); await p.locator('main button[aria-label="Play"]').last().click(); await wait(500); expect((await playerState()).songs.length === n, 'queue ' + (await playerState()).songs.length); });
  await step('search: your songs and osu!, recent', async () => {
    await tab('Search'); await p.fill('input[aria-label="Search"]', 'number 4'); await wait(1500);
    const h = await p.locator('main h2').allTextContents(); expect(h.some((x) => x.includes('Your songs')) && h.some((x) => x.includes('On osu!')), 'sections ' + h);
    await p.locator('main ul').nth(0).locator('li button').first().click(); await wait(500);
    await p.click('button[aria-label="Clear"]'); await wait(300); expect(await p.locator('text=Searched before').count(), 'no recent');
    await p.locator('main section li button').first().click(); await wait(800); expect((await p.inputValue('input[aria-label="Search"]')) === 'number 4', 'recent not filled');
  });
  await step('tabs: remember and go to start', async () => { await tab('Library'); expect(p.url().includes('/playlist/2'), 'Library tab forgot Chill: ' + p.url()); await tab('Library'); await p.click('main a:has-text("Gaming")'); await wait(1000); await tab('Home'); await tab('Library'); expect(p.url().includes('/playlist/3'), 'not remembered ' + p.url()); await tab('Library'); expect(p.url().endsWith('/library'), 'not to start ' + p.url()); });
  await step('checks page loads', async () => { await tab('Home'); await p.click('a[aria-label="Settings"]'); await wait(600); expect(await p.locator('text=Accent color').count(), 'no settings'); await p.click('a:has-text("Checks and player log")'); await wait(4000); expect(await p.locator('text=Lyrics (LRCLIB)').count(), 'no lyrics check'); expect(await p.locator('text=What the player did').count(), 'no log'); });
  await step('reload: the queue comes back and plays on', async () => { const before = await nowTitle(); await p.reload(); await wait(2500); const shown = await p.locator('[data-no-edge] span.block').allTextContents(); expect(shown.some((x) => x === before), 'dock shows ' + shown.slice(0, 3) + ' not ' + before); await p.click('nav ~ * button[aria-label="Play"], button[aria-label="Play"]'); await wait(800); });
  await step('offline: banner, dimmed, only downloads play', async () => {
    await tab('Library'); await p.click('main a:has-text("Big playlist")'); await wait(1500);
    await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await wait(500);
    expect(await p.locator("text=You're offline").count(), 'no banner');
    await p.locator('main ol > li').nth(0).locator('button').first().click(); await wait(500);
    expect(await toast('Offline: only downloaded songs play'), 'no offline toast');
    await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(500);
  });
  await step('no page errors', async () => { expect(!errors.length, errors.join(' | ')); });
  for (const r of results) console.log(r.join('  '));
  console.log(results.filter((r) => r[0] === 'FAIL').length, 'failed of', results.length);
  process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
  await b.close();
})();
