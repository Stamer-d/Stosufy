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

	// --- Parts: split, one taken out; each saved apart; undone and redone ---------------------
	await page.fill('input[aria-label="Start time"]', '0');
	await page.press('input[aria-label="Start time"]', 'Enter');
	await page.fill('input[aria-label="End time"]', '2');
	await page.press('input[aria-label="End time"]', 'Enter');
	await page.click('[role="radiogroup"][aria-label="Fade in"] button:has-text("Off")');
	await page.click('[role="radiogroup"][aria-label="Speed"] button:has-text("1×")');
	const waveBox = await page
		.locator('[role="slider"][aria-label="Start"]')
		.locator('..')
		.boundingBox();
	const at = async (seconds) => {
		await page.mouse.click(waveBox.x + (waveBox.width * seconds) / end, waveBox.y + 30);
		await page.click('button:has-text("Split here")');
	};
	await at(0.5);
	await at(1.5);
	check(
		'split twice: three parts',
		(await page.locator('button[aria-label^="Take out part"]').count()) === 3
	);
	await page.click('button[aria-label="Take out part 2"]');
	check(
		'the length without the middle part: ~1 s',
		(await page.locator('text=Length').innerText()).includes('0:01.0')
	);
	await page.waitForTimeout(500);
	await page.keyboard.press('Control+z');
	await page.waitForSelector('button[aria-label="Take out part 2"]');
	check(
		'Ctrl+Z: the part back in',
		(await page.locator('button[aria-label="Put part 2"]').count()) === 0
	);
	await page.keyboard.press('Control+y');
	await page.waitForSelector('button[aria-label="Put part 2"]');
	check('Ctrl+Y: out again', true);
	await page.click('[role="group"][aria-label="Save as"] [data-target="wav"]');
	await saved('tagged (edited).wav');
	const joined = await lengthOf('tagged (edited).wav');
	check('saved without the middle part: ~1 s', joined > 0.9 && joined < 1.1, String(joined));
	await page.click('button[aria-label="Put part 2"]');
	await page.check('text=Each of the 3 parts as its own file');
	await page.click('[role="group"][aria-label="Save as"] [data-target="wav"]');
	await saved('tagged (part 3).wav');
	const lengths = [];
	for (const n of [1, 2, 3]) lengths.push(+(await lengthOf(`tagged (part ${n}).wav`)).toFixed(2));
	check(
		'each part its own file: 0.5, 1 and 0.5 s',
		JSON.stringify(lengths) === '[0.5,1,0.5]',
		JSON.stringify(lengths)
	);
	await page.click('button[aria-label="Zoom in"]');
	check(
		'zoomed in: 2×, and a way along',
		(await page.locator('text=2.0×').count()) === 1 &&
			(await page.locator('input[aria-label="Where the view is"]').count()) === 1
	);

	// --- The arrow keys move where it plays ---------------------------------------------------
	const seconds = (text) => {
		const [m, s] = text.split(':');
		return Number(m) * 60 + Number(s);
	};
	const now = async () =>
		seconds(await page.locator('[role="timer"][aria-label="Where it plays"]').innerText());
	const from = await now();
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('ArrowRight');
	check(
		'→ a tenth of a second on, Shift+→ a second',
		Math.abs((await now()) - Math.min(end, from + 1.1)) < 0.06,
		`${from} → ${await now()}`
	);

	// --- Another file while there are changes: said first ------------------------------------
	await page.click('[role="radiogroup"][aria-label="Fade in"] button:has-text("1 s")');
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{ name: 'voice.webm', mimeType: 'audio/webm', buffer: fixture('voice.webm') }
	]);
	await page.waitForSelector('[role="alertdialog"][aria-label="Changes not saved"]');
	await page.click('[role="alertdialog"] button:has-text("Keep editing")');
	check(
		'changes not saved: asked first, and kept on a "Keep editing"',
		(await page.locator('h2:has-text("tagged.mp3")').count()) === 1 &&
			(await page.getAttribute(
				'[role="radiogroup"][aria-label="Fade in"] button:has-text("1 s")',
				'aria-checked'
			)) === 'true'
	);
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{ name: 'voice.webm', mimeType: 'video/webm', buffer: fixture('voice.webm') }
	]);
	await page.click('[role="alertdialog"] button:has-text("Open voice.webm anyway")');
	await page.waitForSelector('h2:has-text("voice.webm")');
	check('…or the other file opened anyway', true);

	// --- A WebM with only sound in it: a song ------------------------------------------------
	await page.waitForSelector('[role="slider"][aria-label="End"]');
	const voiceFormats = await page
		.locator('[role="group"][aria-label="Save as"] [data-target]')
		.evaluateAll((all) => all.map((button) => button.dataset.target));
	check(
		'a WebM with only sound: edited as a song (no picture, its sound as MP3, …)',
		(await page.locator('button:has-text("Turn")').count()) === 0 &&
			voiceFormats.includes('mp3') &&
			!voiceFormats.includes('mp4') &&
			!voiceFormats.includes('gif'),
		voiceFormats.join()
	);

	// --- A size limit: a 5-minute song as an MP3 under 8 MB; a WAV can't be ------------------
	const noise = Buffer.alloc(44 + 22050 * 2 * 300);
	noise.write('RIFF', 0);
	noise.writeUInt32LE(36 + 22050 * 2 * 300, 4);
	noise.write('WAVEfmt ', 8);
	noise.writeUInt32LE(16, 16);
	noise.writeUInt16LE(1, 20);
	noise.writeUInt16LE(1, 22);
	noise.writeUInt32LE(22050, 24);
	noise.writeUInt32LE(22050 * 2, 28);
	noise.writeUInt16LE(2, 32);
	noise.writeUInt16LE(16, 34);
	noise.write('data', 36);
	noise.writeUInt32LE(22050 * 2 * 300, 40);
	for (let i = 44; i < noise.length; i += 2)
		noise.writeInt16LE(Math.round((Math.random() - 0.5) * 30000), i);
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{ name: 'noise.wav', mimeType: 'audio/wav', buffer: noise }
	]);
	await page.waitForSelector('h2:has-text("noise.wav")');
	await page.waitForSelector('[role="slider"][aria-label="End"]');
	check(
		'a song: no pictures along its timeline',
		/height: 112px/.test(
			await page.locator('[role="slider"][aria-label="Start"]').locator('..').getAttribute('style')
		)
	);
	await page.click('button[aria-label="Size limit"]');
	await page.click(
		'[role="listbox"][aria-label="Size limit"] [role="option"][data-value="8388608"]'
	);
	await page.click('[role="group"][aria-label="Save as"] [data-target="mp3"]');
	await saved('noise (edited).mp3');
	const limited = (await written('noise (edited).mp3')).length;
	check(
		'under 8 MB: a 5-minute MP3 at a lower bitrate (not 320 kbps: 11 MB)',
		limited <= 8 * 1024 * 1024 && limited > 6 * 1000 * 1000,
		String(limited)
	);
	await page.click('[role="group"][aria-label="Save as"] [data-target="wav"]');
	await saved('noise (edited).wav');
	await page.waitForSelector("text=WAV can't be made smaller: MP3 can");
	check("a WAV can't be made smaller: said so", true);
	await page.click('button[aria-label="Size limit"]');
	await page.click('[role="listbox"][aria-label="Size limit"] [role="option"][data-value="0"]');
	check(
		'the size limit kept for next time',
		(await page.evaluate(() => localStorage.getItem('stosufy-edit-limit'))) === '0'
	);

	// --- A video: turned, without sound; and its sound alone ---------------------------------
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: fixture('clip.mp4') }
	]);
	await page.waitForSelector('h2:has-text("clip.mp4")');
	await page.waitForSelector('[role="slider"][aria-label="End"]');
	// Its pictures along its timeline
	await page.waitForFunction(
		() => {
			const box = document.querySelector('[role="slider"][aria-label="Start"]')?.parentElement;
			const canvas = box?.querySelector('canvas');
			if (!canvas || !/height: 156px/.test(box.getAttribute('style'))) return false;
			const scale = canvas.width / box.clientWidth;
			const pixel = canvas
				.getContext('2d')
				.getImageData(Math.round(20 * scale), Math.round(30 * scale), 1, 1).data;
			return pixel[3] > 200;
		},
		null,
		{ timeout: 20000 }
	);
	check('a video: its pictures along its timeline', true);
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
	// Cut to a square of its (turned) picture, and a frame of it as a picture
	await page.click('button:has-text("Cut the picture")');
	await page.click('[role="radiogroup"][aria-label="Shape"] button:has-text("Square")');
	await page.click('[role="group"][aria-label="Save as"] [data-target="mp4"]');
	await saved('clip (edited) (2).mp4');
	check(
		'the picture cut to a square: 64×64',
		JSON.stringify(await sizeOf('clip (edited) (2).mp4', 'video/mp4')) === '[64,64]'
	);
	await page.click('button:has-text("Save this frame")');
	await page.waitForSelector('text=Saved: clip (frame 0-00.0).png');
	check(
		'a frame as a picture, cut the same',
		JSON.stringify(await sizeOf('clip (frame 0-00.0).png', 'image/png')) === '[64,64]'
	);

	// A GIF of parts of it (the sound left out: a GIF has none)
	await page.click('button:has-text("Cut the picture")');
	const clipEnd = Number(
		await page.getAttribute('[role="slider"][aria-label="End"]', 'aria-valuenow')
	);
	const clipBox = await page
		.locator('[role="slider"][aria-label="Start"]')
		.locator('..')
		.boundingBox();
	for (const share of [1 / 3, 2 / 3]) {
		await page.mouse.click(clipBox.x + clipBox.width * share, clipBox.y + 30);
		await page.click('button:has-text("Split here")');
	}
	await page.click('button[aria-label="Take out part 2"]');
	await page.click('[role="group"][aria-label="Save as"] [data-target="gif"]');
	await saved('clip (edited).gif');
	const gif = Buffer.from(await written('clip (edited).gif')).toString('latin1');
	check(
		'a GIF of two parts of a video with sound',
		gif.startsWith('GIF8') && clipEnd > 0.5,
		gif.slice(0, 6)
	);

	// --- A picture turned, then mirrored: mirrored as it's seen ------------------------------
	const halves = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 40;
		canvas.height = 20;
		const context = canvas.getContext('2d');
		context.fillStyle = '#f00';
		context.fillRect(0, 0, 20, 20);
		context.fillStyle = '#00f';
		context.fillRect(20, 0, 20, 20);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await page.setInputFiles('input[aria-label="Choose a file"]', [
		{ name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(halves, 'base64') }
	]);
	await page.waitForSelector('button:has-text("Turn right")');
	await page.click('button:has-text("Turn right")');
	await page.click('button:has-text("Mirror")');
	await page.click('[role="group"][aria-label="Save as"] [data-target="png"]');
	await saved('halves (edited).png');
	const corners = await page.evaluate(async (path) => {
		const image = new Image();
		image.src = URL.createObjectURL(new Blob([window.__written[path]]));
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext('2d');
		context.drawImage(image, 0, 0);
		const red = (x, y) => context.getImageData(x, y, 1, 1).data[0] > 200;
		return [canvas.width, canvas.height, red(10, 5), red(10, 35)];
	}, `${DIR}/halves (edited).png`);
	check(
		'turned right (its left on top), then mirrored left to right: red still on top',
		JSON.stringify(corners) === '[20,40,true,false]',
		JSON.stringify(corners)
	);

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

	// Lighter: the same picture saved again is brighter; and undone
	const light = async (name) =>
		page.evaluate(async (path) => {
			const image = new Image();
			image.src = URL.createObjectURL(new Blob([window.__written[path]]));
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext('2d');
			context.drawImage(image, 0, 0);
			const px = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let sum = 0;
			for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
			return sum / (px.length / 4) / 3;
		}, `${DIR}/${name}`);
	await page.locator('input[aria-label="Light"]').evaluate((input) => {
		input.value = '50';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	check(
		'lighter: shown so',
		/brightness\(1\.5\)/.test(await page.locator('img[style*="filter"]').getAttribute('style'))
	);
	await page.click('[role="group"][aria-label="Save as"] [data-target="jpg"]');
	await saved('logo (edited) (2).jpg');
	const before = await light('logo (edited).jpg');
	const after = await light('logo (edited) (2).jpg');
	check('…and saved so', after > before + 10, `${before} → ${after}`);
	await page.waitForTimeout(500);
	await page.click('button[aria-label="Undo"]');
	check(
		'undone: as it was',
		(await page.locator('input[aria-label="Light"]').inputValue()) === '0'
	);

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
