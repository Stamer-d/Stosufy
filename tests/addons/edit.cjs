// The file editor: a song cut, faded and made faster (its tags and cover kept), a video
// turned and without sound, its sound alone, a picture turned and cut to a square, and the
// way between it and the converter ("Edit" there, "Convert instead" here). Tauri's files
// mocked (harness.cjs), FFmpeg in WebAssembly (its core from the network).
const fs = require('node:fs');
const path = require('node:path');
const { chromium, start } = require('./harness.cjs');

const results = [];
function check(name, ok, detail = '') {
	results.push(ok);
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
}
const DIR = '/home/tester/Stosufy/Edited';
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));

(async () => {
	const browser = await chromium.launch();
	const { page, errors } = await start(browser, {
		stored: { settings: { addons: ['convert', 'edit'] }, currentQueue: null },
		writes: true,
		allow: /^https:\/\/unpkg\.com\//
	});
	const written = (name) =>
		page.evaluate((path) => {
			const data = window.__written[path];
			return data ? Array.from(data) : null;
		}, `${DIR}/${name}`);
	const saved = (name) =>
		page.waitForFunction((path) => window.__written[path], `${DIR}/${name}`, { timeout: 120000 });
	/** How long a sound file is (s), decoded by the page */
	const lengthOf = (name) =>
		page.evaluate(async (path) => {
			const context = new OfflineAudioContext(1, 1, 22050);
			const audio = await context.decodeAudioData(window.__written[path].slice().buffer);
			return audio.duration;
		}, `${DIR}/${name}`);
	/** A picture's or video's size, read by the page */
	const sizeOf = (name, type) =>
		page.evaluate(
			async ({ path, type }) => {
				const url = URL.createObjectURL(new Blob([window.__written[path]], { type }));
				if (type.startsWith('image/')) {
					const image = new Image();
					image.src = url;
					await image.decode();
					return [image.naturalWidth, image.naturalHeight];
				}
				const video = document.createElement('video');
				video.src = url;
				await new Promise((resolve, reject) => {
					video.onloadedmetadata = resolve;
					video.onerror = reject;
				});
				return [video.videoWidth, video.videoHeight];
			},
			{ path: `${DIR}/${name}`, type }
		);

	// --- From the converter: "Edit" ----------------------------------------------------------
	await page.click('header button[aria-label="File converter"]');
	await page.waitForURL('**/addons/convert');
	await page.setInputFiles('input[aria-label="Choose files"]', [
		{ name: 'tagged.mp3', mimeType: 'audio/mpeg', buffer: fixture('tagged.mp3') }
	]);
	await page.click('button[aria-label="Edit tagged.mp3"]');
	await page.waitForURL('**/addons/edit');
	await page.waitForSelector('h2:has-text("tagged.mp3")');
	check('"Edit" in the converter opens it in the editor', true);

	// --- A song: cut, faded, faster ----------------------------------------------------------
	await page.waitForSelector('[role="slider"][aria-label="End"]');
	const end = Number(await page.getAttribute('[role="slider"][aria-label="End"]', 'aria-valuenow'));
	check('its length is read (2 s)', Math.abs(end - 2) < 0.15, String(end));
	await page.fill('input[aria-label="Start time"]', '0:00.5');
	await page.press('input[aria-label="Start time"]', 'Enter');
	await page.fill('input[aria-label="End time"]', '1.5');
	await page.press('input[aria-label="End time"]', 'Enter');
	await page.click('[role="radiogroup"][aria-label="Fade in"] button:has-text("1 s")');
	await page.click('[role="radiogroup"][aria-label="Speed"] button:has-text("2×")');
	check(
		'the length shown: 1 s at 2× → 0:00.5',
		(await page.locator('text=Length').innerText()).includes('0:00.5')
	);
	const audioFormats = await page
		.locator('[role="group"][aria-label="Save as"] [data-target]')
		.evaluateAll((all) => all.map((button) => button.dataset.target));
	check(
		'its own format first (MP3), then others',
		audioFormats[0] === 'mp3' && audioFormats.includes('wav'),
		audioFormats.join()
	);
	await page.click('[role="group"][aria-label="Save as"] [data-target="mp3"]');
	await saved('tagged (edited).mp3');
	await page.waitForSelector('text=Saved: tagged (edited).mp3');
	const cut = await lengthOf('tagged (edited).mp3');
	check('cut to 0.5–1.5 s at 2×: ~0.5 s long', cut > 0.4 && cut < 0.65, String(cut));
	const mp3 = Buffer.from(await written('tagged (edited).mp3')).toString('latin1');
	check('its title and cover kept', mp3.includes('Tone') && mp3.includes('APIC'));

	// --- A video: turned, without sound; and its sound alone ---------------------------------
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: fixture('clip.mp4') }
	]);
	await page.waitForSelector('h2:has-text("clip.mp4")');
	await page.waitForSelector('[role="slider"][aria-label="End"]');
	await page.click('button:has-text("Turn")');
	await page.click('button:has-text("No sound")');
	await page.click('[role="group"][aria-label="Save as"] [data-target="mp4"]');
	await saved('clip (edited).mp4');
	check(
		'turned: 96×64 → 64×96',
		JSON.stringify(await sizeOf('clip (edited).mp4', 'video/mp4')) === '[64,96]'
	);
	const turned = Buffer.from(await written('clip (edited).mp4')).toString('latin1');
	check('…and without sound', !turned.includes('mp4a'));
	await page.click('button:has-text("No sound")');
	await page.click('[role="group"][aria-label="Save as"] [data-target="mp3"]');
	await saved('clip (edited).mp3');
	check("a video's sound alone, as MP3", (await lengthOf('clip (edited).mp3')) > 0.8);

	// --- A picture: turned, cut to a square, smaller -----------------------------------------
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'logo.png'))
		}
	]);
	await page.waitForSelector('button:has-text("Turn right")');
	await page.click('button:has-text("Turn right")');
	await page.click('[role="radiogroup"][aria-label="Shape"] button:has-text("Square")');
	await page.fill('input[aria-label="Width"]', '100');
	await page.press('input[aria-label="Width"]', 'Enter');
	check('its size shown: 100 × 100', (await page.locator('text=100 × 100 px').count()) === 1);
	await page.click('[role="group"][aria-label="Save as"] [data-target="jpg"]');
	await saved('logo (edited).jpg');
	check(
		'saved: a 100×100 JPG',
		JSON.stringify(await sizeOf('logo (edited).jpg', 'image/jpeg')) === '[100,100]'
	);
	await page.click('button[aria-label="Copy logo (edited).jpg"]');
	await page.waitForSelector('text=Copied as a picture');
	const copied = await page.evaluate(async () => {
		const [item] = await navigator.clipboard.read();
		const image = new Image();
		image.src = URL.createObjectURL(await item.getType('image/png'));
		await image.decode();
		return [image.naturalWidth, image.naturalHeight];
	});
	check('"Copy": the edited picture on the clipboard', JSON.stringify(copied) === '[100,100]');

	// --- Back to the converter ---------------------------------------------------------------
	await page.click('button:has-text("Convert instead")');
	await page.waitForURL('**/addons/convert');
	await page.waitForSelector('li[aria-label="logo.png"]');
	check('"Convert instead" hands it to the converter', true);

	check('no errors', errors.length === 0, errors.join('\n'));
	await page.context().close();

	// --- Without the editor: no "Edit" in the converter --------------------------------------
	{
		const { page } = await start(browser, {
			stored: { settings: { addons: ['convert'] }, currentQueue: null }
		});
		await page.click('header button[aria-label="File converter"]');
		await page.setInputFiles('input[aria-label="Choose files"]', [
			{ name: 'tagged.mp3', mimeType: 'audio/mpeg', buffer: fixture('tagged.mp3') }
		]);
		await page.waitForSelector('li[aria-label="tagged.mp3"]');
		check(
			'the editor not installed: no "Edit"',
			(await page.locator('button[aria-label="Edit tagged.mp3"]').count()) === 0
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
