// The phone audit: every page and overlay, on three phone sizes: page errors, sideways
// overflow, tap targets too small, the last of a page hidden behind the dock
const { chromium, devices } = require('playwright');
const { setup, login } = require('./harness.cjs');
const SIZES = [
  ['SE', { ...devices['iPhone SE'] }],
  ['13', { ...devices['iPhone 13'] }],
  ['ProMax', { ...devices['iPhone 14 Pro Max'] }]
];
const PAGES = ['/', '/library', '/search', '/downloads', '/library/downloads', '/playlist/7', '/playlist/2', '/smart/abc', '/map/122', '/community', '/friends', '/wrapped', '/settings', '/check'];
const findings = new Map();
const note = (kind, where, what) => { const k = `${kind}|${what}`; if (!findings.has(k)) findings.set(k, { kind, what, where: new Set() }); findings.get(k).where.add(where); };
const inspect = (p, where, { bottom = true } = {}) => p.evaluate(({ bottom }) => {
  const out = [];
  const W = innerWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push(['overflow', `page is ${document.documentElement.scrollWidth}px wide (screen ${W})`]);
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    // sideways out of the screen (not inside something that scrolls sideways or clips)
    if (r.right > W + 1 && r.left < W) {
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(o.overflowX) || o.transform !== 'none') { clipped = true; break; } }
      if (!clipped) out.push(['offscreen', `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)}`]);
    }
    const interactive = el.matches('button, a[href], [role=button], [role=switch], [role=slider], [role=radio], input, select');
    if (interactive && !el.closest('[aria-hidden=true]') && r.top < innerHeight && r.bottom > 0 && r.left < W && r.right > 0) {
      if (r.width < 40 || r.height < 40) {
        const label = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName;
        // (a text link inside a sentence is fine)
        const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        if (!inline && el.type !== 'range') out.push(['small', `"${label}" ${Math.round(r.width)}x${Math.round(r.height)}`]);
      }
    }
  }
  return out;
}, { bottom });
const bottomCheck = (p) => p.evaluate(async () => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((r) => setTimeout(r, 400));
  const dock = document.querySelector('nav')?.closest('.fixed');
  const dockTop = dock ? dock.getBoundingClientRect().top : innerHeight;
  const items = [...document.querySelectorAll('main button, main a[href]')].filter((e) => e.getBoundingClientRect().height > 0);
  const last = items.at(-1);
  if (!last) return null;
  const r = last.getBoundingClientRect();
  return r.bottom > dockTop + 2 ? `last tappable "${(last.getAttribute('aria-label') || last.textContent).trim().slice(0, 30)}" under the dock (${Math.round(r.bottom)} > ${Math.round(dockTop)})` : null;
});
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [name, device] of SIZES) {
    const ctx = await b.newContext({ ...device, serviceWorkers: 'block' });
    await setup(ctx);
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|404/.test(m.text()) && errors.push('console: ' + m.text().slice(0, 120)));
    await login(p);
    // something playing (the dock is at its tallest)
    await p.goto('http://127.0.0.1:5288/Stosufy/playlist/2'); await p.waitForTimeout(1500);
    await p.locator('main ol > li').first().locator('button').first().click(); await p.waitForTimeout(800);
    for (const path of PAGES) {
      await p.goto('http://127.0.0.1:5288/Stosufy' + path); await p.waitForTimeout(1800);
      if (path === '/search') { await p.fill('input[aria-label="Search"]', 'song'); await p.waitForTimeout(1200); }
      for (const [kind, what] of await inspect(p, path)) note(kind, `${name} ${path}`, what);
      const hidden = await bottomCheck(p);
      if (hidden) note('dock', `${name} ${path}`, hidden);
      if (name === 'SE') await p.screenshot({ path: `audit_SE${path.replace(/\//g, '_') || '_home'}.png` });
    }
    // overlays
    await p.goto('http://127.0.0.1:5288/Stosufy/playlist/2'); await p.waitForTimeout(1500);
    await p.locator('main ol > li').nth(1).locator('button[aria-label^="More"]').click(); await p.waitForTimeout(500);
    for (const [kind, what] of await inspect(p)) note(kind, `${name} song menu`, what);
    if (name === 'SE') await p.screenshot({ path: 'audit_SE_menu.png' });
    await p.locator('.fixed.inset-0.z-40 > button[aria-label="Close"]').click({ position: { x: 50, y: 50 } }); await p.waitForTimeout(500);
    await p.locator('button[aria-label="Open the player"]').first().click(); await p.waitForTimeout(800);
    for (const [kind, what] of await inspect(p)) note(kind, `${name} player`, what);
    if (name === 'SE') await p.screenshot({ path: 'audit_SE_player.png' });
    await p.click('.fixed.inset-0.z-30 button[aria-label^="Speed mod"]'); await p.waitForTimeout(500);
    for (const [kind, what] of await inspect(p)) note(kind, `${name} speed sheet`, what);
    if (name === 'SE') await p.screenshot({ path: 'audit_SE_mods.png' });
    await p.locator('.fixed.inset-0.z-40 > button[aria-label="Close"]').click({ position: { x: 50, y: 50 } }); await p.waitForTimeout(400);
    await p.click('.fixed.inset-0.z-30 button[aria-label="Up next"]'); await p.waitForTimeout(400);
    for (const [kind, what] of await inspect(p)) note(kind, `${name} queue`, what);
    if (name === 'SE') await p.screenshot({ path: 'audit_SE_queue.png' });
    await p.click('.fixed.inset-0.z-30 button[aria-label="Close"]'); await p.waitForTimeout(500);
    await p.goto('http://127.0.0.1:5288/Stosufy/search'); await p.waitForTimeout(1200);
    await p.click('header button:has-text("Genre")'); await p.waitForTimeout(500);
    for (const [kind, what] of await inspect(p)) note(kind, `${name} filter sheet`, what);
    // landscape
    await p.setViewportSize({ width: device.viewport.height, height: device.viewport.width });
    await p.goto('http://127.0.0.1:5288/Stosufy/playlist/2'); await p.waitForTimeout(1500);
    for (const [kind, what] of await inspect(p)) note(kind, `${name} landscape playlist`, what);
    if (name === 'SE') await p.screenshot({ path: 'audit_SE_landscape.png' });
    for (const e of errors) note('error', name, e);
    await ctx.close();
  }
  await b.close();
  const order = ['error', 'overflow', 'offscreen', 'dock', 'small'];
  for (const f of [...findings.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const where = [...f.where];
    console.log(`[${f.kind}] ${f.what}  —  ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` +${where.length - 4}` : ''}`);
  }
  console.log('findings', findings.size);
})();
