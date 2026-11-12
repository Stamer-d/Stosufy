// The add-ons: the store, installing and removing, what each one adds to the app, and which
// are installed for a new user, for settings from before add-ons and across devices
const { chromium, start, saved } = require('./harness.cjs');

// (those that were part of the app before there were add-ons, and all of them)
const NAMES = ['DJ mode', 'Dash', 'Puzzle', 'World center'];
const ALL = [...NAMES, 'File converter'];
const results = [];
function check(name, ok, detail = '') {
	results.push(ok);
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The add-ons' buttons in the title bar */
const buttons = (page) =>
	page
		.locator('header')
		.first()
		.locator('button[aria-label]')
		.evaluateAll(
			(all, names) =>
				all
					.map((button) => button.getAttribute('aria-label'))
					.filter((label) => names.includes(label)),
			ALL
		);
const card = (page, name) => page.locator(`article[aria-label="${name}"]`);
const install = (page, name) => card(page, name).locator('button:has-text("Install")').click();
const uninstall = (page, name) => card(page, name).locator('button:has-text("Uninstall")').click();
const store = (page) => page.click('header button[aria-label="Add-ons"]');
const view = '.fixed.inset-0.z-40';
const widget = (name) => `[role="group"][aria-label="${name}"]`;
/** The widget store, from the home page (its buttons show while the mouse moves there) */
async function widgetStore(page) {
	await page.click('header button[aria-label="Home"]');
	await page.waitForURL('**/home');
	await page.mouse.move(800, 400);
	await page.mouse.move(820, 420);
	await page.click('main button:has-text("Edit widgets")');
	await page.click('main button:has-text("Add widgets")');
}
const PLACED = [
	{ uid: 'w1', type: 'mac-weather', x: 0.5, y: 0.3 },
	{ uid: 'c1', type: 'minimal-clock', x: 0.03, y: 0.04 }
];

(async () => {
	const browser = await chromium.launch();

	// --- A new user: nothing installed, everything to install ----------------------------
	{
		const { page, errors } = await start(browser);
		check('new user: no add-on in the title bar', same(await buttons(page), []));
		await store(page);
		await page.waitForURL('**/addons');
		check(
			'store: every add-on, each to install',
			(await page.locator('article button:has-text("Install")').count()) === ALL.length
		);

		await install(page, 'DJ mode');
		await page.waitForSelector('header button[aria-label="DJ mode"]');
		check(
			'DJ mode: installed, in the title bar',
			(await card(page, 'DJ mode').locator('text=Installed').count()) === 1
		);
		check(
			'DJ mode: kept in the settings',
			same(await saved(page), { addons: ['dj'] }),
			JSON.stringify(await saved(page))
		);
		await page.click('header button[aria-label="DJ mode"]');
		await page.waitForSelector(view);
		check('DJ mode: opens over the app', (await page.locator(view).count()) === 1);
		// (the DJ mode has the title bar too, over the app's)
		await page.locator('button[aria-label="Leave DJ mode"]').last().click();
		await page.waitForSelector(view, { state: 'detached' });
		check('DJ mode: closes with its button', true);

		await install(page, 'Dash');
		await card(page, 'Dash').locator('button:has-text("Open")').click();
		await page.waitForSelector(view);
		await page.waitForFunction(() => !!document.querySelector('.h-screen.invisible'));
		check('Dash: opens, the app under it is not drawn', true);
		await page.keyboard.press('Escape');
		await page.waitForSelector(view, { state: 'detached' });
		check(
			'Dash: closes, the app is back',
			(await page.locator('.h-screen.invisible').count()) === 0
		);

		// (once the settings are saved: a moment after the change)
		await saved(page);
		await page.reload();
		await page.waitForURL('**/home');
		await page.waitForSelector('header button[aria-label="Dash"]');
		check(
			'after a restart: still installed',
			same(await buttons(page), ['DJ mode', 'Dash']),
			JSON.stringify(await buttons(page))
		);

		await store(page);
		await install(page, 'Puzzle');
		await page.click('header button[aria-label="Puzzle"]');
		await page.waitForURL('**/addons/puzzle');
		await page.waitForSelector('main h1:has-text("Puzzle")');
		check(
			'Puzzle: its page, its button lit',
			(await page.getAttribute('header button[aria-label="Puzzle"]', 'aria-pressed')) === 'true'
		);

		// The world center: a page, and widgets
		await widgetStore(page);
		await page.waitForSelector('text=more widgets with the World center add-on');
		check(
			"widgets: the world center's only once it's installed",
			(await page.locator('button[aria-label="Add Weather"]').count()) === 0
		);
		await page.click('button:has-text("Get it")');
		await page.waitForURL('**/addons');
		await install(page, 'World center');
		await card(page, 'World center').locator('button:has-text("Open")').click();
		await page.waitForURL('**/addons/world');
		await page.waitForSelector('main input[placeholder="Search a place"]');
		check('World center: its page', true);
		check(
			"title bar: in the store's order",
			same(await buttons(page), ['DJ mode', 'Dash', 'Puzzle', 'World center']),
			JSON.stringify(await buttons(page))
		);
		await widgetStore(page);
		await page.waitForSelector('button[aria-label="Add Weather"]');
		check(
			"widgets: the world center's are there now",
			(await page.locator('text=more widgets with').count()) === 0
		);
		await page.click('button[aria-label="Add Weather"]');
		await page.click('[role="dialog"] button:has-text("Done"), dialog button:has-text("Done")');
		await page.waitForSelector(widget('Weather'));
		check('widgets: one placed on the home screen', true);

		// Removed again
		await store(page);
		await uninstall(page, 'World center');
		await page.waitForSelector('header button[aria-label="World center"]', { state: 'detached' });
		check(
			'World center: removed',
			same((await saved(page)).addons, ['dj', 'dash', 'puzzle']),
			JSON.stringify((await saved(page)).addons)
		);
		// (a link to its page, while it isn't installed)
		await page.evaluate(() => {
			const link = document.createElement('a');
			link.href = '/addons/world';
			document.querySelector('main').append(link);
			link.click();
		});
		await page.waitForSelector("text=World center isn't installed");
		await page.click('main button:has-text("Install")');
		await page.waitForSelector('main input[placeholder="Search a place"]');
		check(
			"its page installs it when it isn't",
			same(await buttons(page), ['DJ mode', 'Dash', 'Puzzle', 'World center'])
		);

		await store(page);
		await page.click('button:has-text("Installed")');
		for (const name of NAMES) await uninstall(page, name);
		await page.waitForSelector('text=No add-ons installed yet');
		check('all removed: none in the title bar', same(await buttons(page), []));
		check('no errors', errors.length === 0, errors.join('\n'));
		await page.context().close();
	}

	// --- Settings from before add-ons: what was part of the app stays --------------------
	{
		const { page } = await start(browser, {
			stored: { settings: { home: { layout: 'desktop', widgets: PLACED } }, currentQueue: null }
		});
		check(
			'settings from before: all installed',
			same(await buttons(page), NAMES),
			JSON.stringify(await buttons(page))
		);
		await page.waitForSelector(widget('Weather'));
		check('settings from before: the placed weather widget is there', true);
		await store(page);
		await uninstall(page, 'World center');
		await page.click('header button[aria-label="Home"]');
		await page.waitForSelector(widget('Big clock'));
		check(
			'world center removed: its widget is gone, the others stay',
			(await page.locator(widget('Weather')).count()) === 0
		);
		const settings = await saved(page);
		check(
			"…and kept for when it's installed again",
			settings.home.widgets.some((placed) => placed.type === 'mac-weather')
		);
		await store(page);
		await install(page, 'World center');
		await page.click('header button[aria-label="Home"]');
		await page.waitForSelector(widget('Weather'));
		check('installed again: the widget is back', true);
		await page.context().close();
	}
	{
		const { page } = await start(browser, {
			stored: { settings: { addons: ['puzzle'] }, currentQueue: null }
		});
		check(
			'saved add-ons: those, no others',
			same(await buttons(page), ['Puzzle']),
			JSON.stringify(await buttons(page))
		);
		await page.context().close();
	}

	// --- The account's settings --------------------------------------------------------------
	{
		// An account from before add-ons, on a new device
		const { page, sent } = await start(browser, {
			account: { settings: { appearance: { accent: 'teal' } }, updatedAt: 5 }
		});
		await page.waitForSelector('header button[aria-label="World center"]');
		check(
			'account from before, new device: all installed',
			same(await buttons(page), NAMES),
			JSON.stringify(await buttons(page))
		);
		await page.waitForTimeout(500);
		check(
			'…and the account is told',
			same(sent.at(-1)?.addons, ['dj', 'dash', 'world', 'puzzle']),
			JSON.stringify(sent)
		);
		await page.context().close();
	}
	{
		// A new user: the account gets "none", and what's installed after
		const { page, sent } = await start(browser, { account: null });
		await page.waitForTimeout(500);
		check(
			'new account: none installed, said to the account',
			same(await buttons(page), []) && same(sent.at(-1)?.addons, []),
			JSON.stringify(sent)
		);
		await store(page);
		await install(page, 'Puzzle');
		await page.waitForTimeout(2600);
		check(
			'installed: sent to the account',
			same(sent.at(-1)?.addons, ['puzzle']),
			JSON.stringify(sent)
		);
		await page.context().close();
	}
	{
		// Installed on another device: here too
		const { page } = await start(browser, {
			stored: { settings: { addons: [] }, currentQueue: null },
			account: { settings: { addons: ['dash', 'dj'] }, updatedAt: 9 }
		});
		await page.waitForSelector('header button[aria-label="Dash"]');
		check(
			'installed on another device: here too',
			same(await buttons(page), ['DJ mode', 'Dash']),
			JSON.stringify(await buttons(page))
		);
		await page.context().close();
	}

	await browser.close();
	console.log(`\n${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
