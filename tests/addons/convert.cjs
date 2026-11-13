// The file converter: files chosen, made into other formats, saved (Tauri's files mocked, see
// harness.cjs) and looked at: pictures, sound and video (through FFmpeg, whose core comes from
// the network), data, text and archives, a broken file, a name that's taken, one ZIP of all.
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { chromium, start } = require('./harness.cjs');

const results = [];
function check(name, ok, detail = '') {
	results.push(ok);
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
}
const DIR = '/home/tester/Stosufy/Converted';
const root = path.join(__dirname, '..', '..');

/** One second of a 440 Hz tone, as a WAV */
function wav() {
	const rate = 22050;
	const samples = rate;
	const out = Buffer.alloc(44 + samples * 2);
	out.write('RIFF', 0);
	out.writeUInt32LE(36 + samples * 2, 4);
	out.write('WAVEfmt ', 8);
	out.writeUInt32LE(16, 16);
	out.writeUInt16LE(1, 20);
	out.writeUInt16LE(1, 22);
	out.writeUInt32LE(rate, 24);
	out.writeUInt32LE(rate * 2, 28);
	out.writeUInt16LE(2, 32);
	out.writeUInt16LE(16, 34);
	out.write('data', 36);
	out.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
	return out;
}

// [file, what its result is called, target, how that starts (bytes, or text at an offset)]
const MORE = [
	['p-webp.png', 'p-webp.webp', 'webp', [8, 'WEBP']],
	['p-tiff.png', 'p-tiff.tiff', 'tiff', [0, 'II*\0']],
	['p-bmp.png', 'p-bmp.bmp', 'bmp', [0, 'BM']],
	['t-flac.wav', 't-flac.flac', 'flac', [0, 'fLaC']],
	['t-ogg.wav', 't-ogg.ogg', 'ogg', [0, 'OggS']],
	['t-m4a.wav', 't-m4a.m4a', 'm4a', [4, 'ftyp']],
	['t-aiff.wav', 't-aiff.aiff', 'aiff', [8, 'AIFF']],
	['c-wav.mp4', 'c-wav.wav', 'wav', [8, 'WAVE']],
	['c-webm.mp4', 'c-webm.webm', 'webm', [0, '\x1a\x45\xdf\xa3']],
	['c-mkv.mp4', 'c-mkv.mkv', 'mkv', [0, '\x1a\x45\xdf\xa3']],
	['c-mov.mov', 'c-mov.mp4', 'mp4', [4, 'ftyp']],
	['c-qt.mp4', 'c-qt.mov', 'mov', [4, 'ftyp']],
	['c-avi.mp4', 'c-avi.avi', 'avi', [8, 'AVI ']]
];

/** A 1×1 PNG */
const TINY = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

/** A file's row in the list */
let row;
/** Its format clicked: a button, or in "More" */
async function pick(at, target) {
	const button = at.locator(`button[data-target="${target}"]`);
	if (await button.count()) await button.first().click();
	else {
		await at.locator('button[aria-label="More formats"]').click();
		await at.locator(`[role="menuitem"][data-target="${target}"]`).click();
	}
}

(async () => {
	const zip = new JSZip();
	zip.file('notes/hello.txt', 'hello');
	zip.file('../escape.txt', 'kept inside');
	const png = fs.readFileSync(path.join(root, 'static', 'logo.png'));
	const clip = fs.readFileSync(path.join(__dirname, 'fixtures', 'clip.mp4'));
	// (the same H.264 and AAC in an MKV: timed in milliseconds, as yt-dlp's are)
	const clipMkv = fs.readFileSync(path.join(__dirname, 'fixtures', 'clip.mkv'));
	// (59.94 fps converted from an MKV by an earlier version: 19001ths of a second, unevenly)
	const uneven = fs.readFileSync(path.join(__dirname, 'fixtures', 'uneven.mp4'));
	// (2 s of a tone, titled "Tone" by "Stosufy", with a cover)
	const tagged = fs.readFileSync(path.join(__dirname, 'fixtures', 'tagged.mp3'));
	const mp3 = (name) => ({ name, mimeType: 'audio/mpeg', buffer: tagged });
	const text = (name, mimeType, body) => ({ name, mimeType, buffer: Buffer.from(body) });
	// [file, target]
	const FILES = [
		[{ name: 'logo.png', mimeType: 'image/png', buffer: png }, 'jpg'],
		[{ name: 'icon.png', mimeType: 'image/png', buffer: png }, 'ico'],
		[{ name: 'page.png', mimeType: 'image/png', buffer: png }, 'pdf'],
		[{ name: 'still.png', mimeType: 'image/png', buffer: png }, 'gif'],
		[{ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() }, 'mp3'],
		[{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: clip }, 'gif'],
		[{ name: 'sound.mp4', mimeType: 'video/mp4', buffer: clip }, 'opus'],
		// (repacked: its H.264 and AAC fit an MKV as they are)
		[{ name: 'repack.mp4', mimeType: 'video/mp4', buffer: clip }, 'mkv'],
		// (an MKV's H.264 into an MP4: made again, evenly timed, not repacked as it's timed)
		[{ name: 'boxed.mkv', mimeType: 'video/x-matroska', buffer: clipMkv }, 'mp4'],
		// (an MP4 made from an MKV before, unevenly timed: for editing, made again)
		[{ name: 'uneven.mp4', mimeType: 'video/mp4', buffer: uneven }, 'editing'],
		// (for Premiere: an MP4's, evenly timed, repacked; an MKV's made again, evenly)
		[{ name: 'premiere.mp4', mimeType: 'video/mp4', buffer: clip }, 'editing'],
		[{ name: 'premiere-mkv.mkv', mimeType: 'video/x-matroska', buffer: clipMkv }, 'editing'],
		[
			text('data.json', 'application/json', '{"name":"Stosufy","tags":["osu","music"],"n":3}'),
			'yaml'
		],
		[text('table.csv', 'text/csv', 'id;title;bpm\n1;"A; B";180\n2;Song 2;95.5\n'), 'json'],
		[
			text(
				'feed.xml',
				'application/xml',
				'<songs><song id="1">A</song><song id="2">B</song></songs>'
			),
			'json'
		],
		[
			text('conf.yaml', 'text/yaml', 'title: x\nlist:\n  - 1\n  - 2\nnested:\n  on: true\n'),
			'toml'
		],
		[
			text('readme.md', 'text/markdown', '# Title\n\nSome **bold** text.\n\n- one\n- two\n'),
			'html'
		],
		[
			text(
				'page.html',
				'text/html',
				'<h1>Head</h1><p>A <a href="https://x.y">link</a>.</p><ul><li>a</li></ul>'
			),
			'md'
		],
		[
			{
				name: 'pack.zip',
				mimeType: 'application/zip',
				buffer: await zip.generateAsync({ type: 'nodebuffer' })
			},
			'unzip'
		],
		// (the other formats, checked by how their files start)
		...MORE.map(([name, , target]) => {
			const from = name.split('.')[1];
			const buffer = from === 'png' ? png : from === 'wav' ? wav() : clip;
			return [{ name, mimeType: '', buffer }, target];
		}),
		[mp3('tagged.mp3'), 'flac'],
		[mp3('tagged-m4a.mp3'), 'm4a'],
		[mp3('tagged-ogg.mp3'), 'ogg'],
		[text('broken.json', 'application/json', '{"a": '), 'csv'],
		// (UTF-16, as Excel's "Unicode text" writes it)
		[
			{
				name: 'utf16.csv',
				mimeType: 'text/csv',
				buffer: Buffer.concat([
					Buffer.from([0xff, 0xfe]),
					Buffer.from('name,city\nJürgen,Köln\n', 'utf16le')
				])
			},
			'json'
		],
		// (codes with their zeros, words that look like true: as they're written)
		[text('codes.csv', 'text/csv', 'zip;flag;n\n00123;TRUE;7\n'), 'json'],
		[
			text(
				'dates.toml',
				'application/toml',
				'when = 1979-05-27T07:32:00Z\nbig = 9007199254740993\n'
			),
			'json'
		],
		// (two of the same name at once: a name each)
		[{ name: 'twin.wav', mimeType: 'audio/wav', buffer: wav() }, 'mp3'],
		[{ name: 'twin.WAV', mimeType: 'audio/wav', buffer: wav() }, 'mp3'],
		[text('blob.bin', 'application/octet-stream', 'abc'), 'base64']
	];

	const browser = await chromium.launch();
	const { page, errors } = await start(browser, {
		stored: { settings: { addons: ['convert'] }, currentQueue: null },
		writes: true,
		allow: /^https:\/\/unpkg\.com\//
	});
	row = (name) => page.locator(`li[aria-label="${name}"]`).last();
	await page.click('header button[aria-label="File converter"]');
	await page.waitForURL('**/addons/convert');
	check('its title bar button opens its page', true);

	// The menus up in the header: open out of it, under it, every option seen (not cut off by
	// the header, one line high)
	for (const label of ['Size limit', 'Quality']) {
		await page.click(`[role="combobox"][aria-label^="${label}:"]`);
		const list = page.locator(`[role="listbox"][aria-label="${label}"]`);
		await list.waitFor();
		const seen = await list.evaluate((ul) => {
			const box = ul.getBoundingClientRect();
			const button = ul.parentElement.getBoundingClientRect();
			const options = [...ul.querySelectorAll('[role="option"]')];
			const shown = options.filter((option) => {
				const r = option.getBoundingClientRect();
				const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				return r.bottom <= box.bottom + 1 && option.contains(at);
			});
			return { below: box.top >= button.bottom, shown: shown.length, all: options.length };
		});
		check(
			`the ${label} menu: under its button, all ${seen.all} options seen`,
			seen.below && seen.shown === seen.all,
			JSON.stringify(seen)
		);
		await page.keyboard.press('Escape');
	}

	await page.setInputFiles(
		'input[aria-label="Choose files"]',
		FILES.map(([file]) => file)
	);
	await page.waitForSelector(`li[aria-label="${FILES.at(-1)[0].name}"]`);
	check(
		'every file is in the list',
		(await page.locator('ul[aria-label="Files"] > li').count()) === FILES.length
	);
	const offered = async (row) => {
		const more = row.locator('button[aria-label="More formats"]');
		if (await more.count()) await more.click();
		const ids = await row.evaluate((li) =>
			[...li.querySelectorAll('[data-target]')].map((button) => button.dataset.target)
		);
		if (await more.count()) await row.page().keyboard.press('Escape');
		return ids;
	};
	const data = await offered(row('data.json'));
	check(
		'a JSON can become YAML, TOML, CSV, XML…',
		['yaml', 'toml', 'csv', 'tsv', 'xml', 'zip'].every((id) => data.includes(id)),
		data.join()
	);
	const video = await offered(row('clip.mp4'));
	check(
		'an MP4: MP3 first, then MP4 for editing, GIF, WebM…',
		video.slice(0, 4).join() === 'mp3,editing,gif,webm',
		video.join()
	);
	check(
		'files of all kinds: no "All to" for them',
		!(await page.locator('text=/^All \\d+ .* to$/').count())
	);
	// One click on a format: converted right away
	for (const [file, target] of FILES) await pick(row(file.name), target);

	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('ul[aria-label="Files"] > li')].every((li) =>
				['done', 'failed'].includes(li.dataset.status)
			),
		null,
		{ timeout: 240000 }
	);
	const statuses = await page
		.locator('ul[aria-label="Files"] > li')
		.evaluateAll((all) =>
			Object.fromEntries(all.map((li) => [li.getAttribute('aria-label'), li.dataset.status]))
		);
	const failedOnes = Object.entries(statuses)
		.filter(([, status]) => status === 'failed')
		.map(([name]) => name);
	check(
		'all converted but the broken one',
		failedOnes.length === 1 && failedOnes[0] === 'broken.json',
		JSON.stringify(failedOnes)
	);
	check(
		'…which says why',
		/Not valid JSON/.test(await page.locator('li[aria-label="broken.json"]').innerText())
	);

	const written = await page.evaluate(() =>
		Object.fromEntries(
			Object.entries(window.__written).map(([name, data]) => [name, Array.from(data)])
		)
	);
	const file = (name) => Buffer.from(written[`${DIR}/${name}`] ?? []);
	const starts = (name, bytes) => file(name).subarray(0, bytes.length).equals(Buffer.from(bytes));
	const asText = (name) => file(name).toString('utf8');

	check('PNG → JPG', starts('logo.jpg', [0xff, 0xd8, 0xff]));
	const said = (name) => page.locator(`li[aria-label="${name}"]`).innerText();
	const box = (name) => file(name).subarray(4, 8).toString();
	/** An MP4's first track's (its picture's) time base: its mdhd's timescale */
	const videoTimescale = (data) => {
		const at = data.indexOf('mdhd');
		if (at < 0) return 0;
		return data[at + 4] === 1 ? data.readUInt32BE(at + 24) : data.readUInt32BE(at + 16);
	};
	check(
		'MP4 (H.264, AAC) → MKV: repacked, said so, the picture as it was',
		/Repacked as it was/.test(await said('repack.mp4')) &&
			starts('repack.mkv', [0x1a, 0x45, 0xdf, 0xa3]) &&
			file('repack.mkv').includes(
				clip.subarray(clip.indexOf('mdat') + 8, clip.indexOf('mdat') + 200)
			),
		await said('repack.mp4')
	);
	check(
		'MKV (H.264, timed in milliseconds) → MP4: made again, evenly, not repacked',
		!/Repacked/.test(await said('boxed.mkv')) && box('boxed.mp4') === 'ftyp',
		await said('boxed.mkv')
	);
	check(
		'MP4 for editing, of an MP4 converted from an MKV before (59.94 in 19001ths): made again',
		!/Repacked/.test(await said('uneven.mp4')) &&
			box('uneven.mp4') === 'ftyp' &&
			// (its picture's time base: 60000ths of a second, each picture 1001 of them)
			videoTimescale(file('uneven.mp4')) === 60000,
		`${await said('uneven.mp4')} / ${videoTimescale(file('uneven.mp4'))}`
	);
	check(
		'MP4 for editing, of an evenly timed MP4: repacked',
		/Repacked as it was/.test(await said('premiere.mp4')) &&
			file('premiere.mp4').subarray(4, 8).toString() === 'ftyp'
	);
	check(
		'MP4 for editing, of an MKV (timed in milliseconds): made again, not repacked',
		!/Repacked/.test(await said('premiere-mkv.mkv')) &&
			file('premiere-mkv.mp4').subarray(4, 8).toString() === 'ftyp' &&
			file('premiere-mkv.mp4').length > 1000,
		await said('premiere-mkv.mkv')
	);
	check('PNG → ICO', starts('icon.ico', [0, 0, 1, 0]));
	check(
		'PNG → PDF',
		asText('page.pdf').startsWith('%PDF-1.4') && asText('page.pdf').trim().endsWith('%%EOF')
	);
	check('PNG → GIF (through FFmpeg)', asText('still.gif').startsWith('GIF89a'));
	check(
		'WAV → MP3',
		file('tone.mp3').length > 1000 &&
			(starts('tone.mp3', [0x49, 0x44, 0x33]) || file('tone.mp3')[0] === 0xff)
	);
	check('MP4 → GIF', asText('clip.gif').startsWith('GIF89a'));
	check(
		'MP4 → only the sound, Opus',
		asText('sound.opus').startsWith('OggS') && asText('sound.opus').includes('OpusHead')
	);
	check(
		'JSON → YAML',
		/^name: Stosufy\ntags:\n {2}- osu\n {2}- music\nn: 3\n$/.test(asText('data.yaml')),
		asText('data.yaml')
	);
	let rows = null;
	try {
		rows = JSON.parse(asText('table.json'));
	} catch {}
	check(
		'CSV (with ;) → JSON, numbers as numbers',
		JSON.stringify(rows) ===
			JSON.stringify([
				{ id: 1, title: 'A; B', bpm: 180 },
				{ id: 2, title: 'Song 2', bpm: 95.5 }
			]),
		asText('table.json')
	);
	let feed = null;
	try {
		feed = JSON.parse(asText('feed.json'));
	} catch {}
	check(
		'XML → JSON, attributes and repeated elements',
		JSON.stringify(feed) ===
			JSON.stringify({
				songs: {
					song: [
						{ '@id': '1', '#text': 'A' },
						{ '@id': '2', '#text': 'B' }
					]
				}
			}),
		asText('feed.json')
	);
	check(
		'YAML → TOML',
		/title = "x"/.test(asText('conf.toml')) && /\[nested\]\non = true/.test(asText('conf.toml')),
		asText('conf.toml')
	);
	check(
		'Markdown → HTML',
		/<title>Title<\/title>/.test(asText('readme.html')) &&
			/<strong>bold<\/strong>/.test(asText('readme.html'))
	);
	check(
		'HTML → Markdown',
		/^# Head\n\nA \[link\]\(https:\/\/x\.y\)\.\n\n- a\n$/.test(asText('page.md')),
		JSON.stringify(asText('page.md'))
	);
	for (const [from, to, target, [offset, start]] of MORE)
		check(
			`${from.split('.')[1].toUpperCase()} → ${target.toUpperCase()}`,
			file(to).length > 100 && file(to).toString('latin1', offset, offset + start.length) === start,
			`${file(to).length} bytes: ${JSON.stringify(file(to).toString('latin1', 0, 16))}`
		);
	check('ZIP unpacked, in a folder of its own', asText('pack/notes/hello.txt') === 'hello');
	check(
		'…and nothing out of it',
		asText('pack/escape.txt') === 'kept inside' && !written['/home/tester/Stosufy/escape.txt']
	);
	check('any file → Base64', asText('blob.bin.txt') === 'YWJj\n');
	check(
		'a UTF-16 CSV → JSON, its letters as they are',
		asText('utf16.json').includes('"name": "Jürgen"') && asText('utf16.json').includes('Köln'),
		asText('utf16.json')
	);
	let codes = null;
	try {
		codes = JSON.parse(asText('codes.json'));
	} catch {}
	check(
		'CSV → JSON: "00123" and "TRUE" kept as written, 7 a number',
		JSON.stringify(codes) === JSON.stringify([{ zip: '00123', flag: 'TRUE', n: 7 }]),
		asText('codes.json')
	);
	check(
		'TOML → JSON: a date as a date, a big number exactly',
		asText('dates.json').includes('"1979-05-27T07:32:00.000Z"') &&
			asText('dates.json').includes('9007199254740993'),
		asText('dates.json')
	);
	check(
		'two of the same name at once: twin.mp3 and twin (2).mp3',
		file('twin.mp3').length > 1000 && file('twin (2).mp3').length > 1000
	);
	const latin = (name) => file(name).toString('latin1');
	check(
		'MP3 → FLAC: its title, artist and cover kept',
		/TITLE=Tone/i.test(latin('tagged.flac')) &&
			/ARTIST=Stosufy/i.test(latin('tagged.flac')) &&
			latin('tagged.flac').includes('image/jpeg')
	);
	check(
		'MP3 → M4A: title and cover kept',
		latin('tagged-m4a.m4a').includes('Tone') && latin('tagged-m4a.m4a').includes('covr')
	);
	check(
		'MP3 → OGG: the title kept (OGG holds no cover)',
		/TITLE=Tone/i.test(latin('tagged-ogg.ogg'))
	);

	// Copied: text as text, a picture as a picture, anything else as the file(s)
	await page.click('button[aria-label="Copy data.yaml"]');
	await page.waitForSelector('text=Copied as text');
	check(
		'"Copy" on a YAML: its text on the clipboard',
		(await page.evaluate(() => navigator.clipboard.readText())) === asText('data.yaml')
	);
	await page.click('button[aria-label="Copy logo.jpg"]');
	await page.waitForSelector('text=Copied as a picture');
	const types = await page.evaluate(async () =>
		(await navigator.clipboard.read()).flatMap((item) => item.types)
	);
	check('"Copy" on a JPG: a picture on the clipboard', types.includes('image/png'), types.join());
	await page.click('button[aria-label="Copy tone.mp3"]');
	await page.waitForFunction(() => window.__copied);
	check(
		'"Copy" on an MP3: the file itself',
		JSON.stringify(await page.evaluate(() => window.__copied)) ===
			JSON.stringify([`${DIR}/tone.mp3`])
	);
	await page.locator('li[aria-label="pack.zip"] button[aria-label^="Copy"]').click();
	await page.waitForFunction(() => window.__copied?.length === 2);
	check('"Copy" on an unpacked ZIP: both of its files', true);

	// The same file again: a name of its own
	await page.setInputFiles('input[aria-label="Choose files"]', [FILES[0][0]]);
	const lastPng = FILES.findLast(([file]) => file.name.endsWith('.png'))[1];
	check(
		'a new file: the last format chosen for its type is offered first',
		(await offered(row('logo.png')))[0] === lastPng
	);
	await pick(row('logo.png'), 'jpg');
	await page.waitForFunction(() => window.__written['/home/tester/Stosufy/Converted/logo (2).jpg']);
	check('a name that is taken: "logo (2).jpg"', true);

	await page.click('button:has-text("All as one ZIP")');
	await page.waitForFunction(() =>
		Object.keys(window.__written).some(
			(name) => name.endsWith('.zip') && name.includes('Converted 2')
		)
	);
	const zipName = Object.keys(await page.evaluate(() => window.__written)).find((name) =>
		/Converted \d.*\.zip$/.test(name)
	);
	const all = await JSZip.loadAsync(
		Buffer.from(await page.evaluate((name) => Array.from(window.__written[name]), zipName))
	);
	const inside = Object.keys(all.files).filter((name) => !all.files[name].dir);
	check(
		'all of them as one ZIP',
		['logo.jpg', 'logo (2).jpg', 'clip.gif', 'pack/notes/hello.txt', 'table.json'].every((name) =>
			inside.includes(name)
		),
		inside.join()
	);

	await page.click('button:has-text("Clear the list")');
	await page.waitForSelector('text=Drop files here');
	check('the list cleared', true);

	// Several of a kind: all at once
	await page.setInputFiles(
		'input[aria-label="Choose files"]',
		['a', 'b', 'c'].map((n) => ({ name: `${n}.wav`, mimeType: 'audio/wav', buffer: wav() }))
	);
	await page.waitForSelector('text=All 3 sound files to');
	await pick(page.locator('[role="group"][aria-label="All files to"]'), 'flac');
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('ul[aria-label="Files"] > li')].every(
				(li) => li.dataset.status === 'done'
			),
		null,
		{ timeout: 60000 }
	);
	check(
		'"All 3 sound files to FLAC": three FLACs',
		await page.evaluate(() =>
			['a', 'b', 'c'].every(
				(n) => window.__written[`/home/tester/Stosufy/Converted/${n}.flac`]?.length > 100
			)
		)
	);
	check('…and the bar is gone', !(await page.locator('text=All 3 sound files to').count()));
	await page.locator('li[aria-label="a.wav"] button:has-text("Other format")').click();
	check(
		'"Other format": its formats again',
		(await page.locator('li[aria-label="a.wav"] button[data-target]').count()) > 0
	);

	check('no errors', errors.length === 0, errors.join('\n'));
	await page.context().close();

	// --- A size limit -----------------------------------------------------------------------
	{
		const LIMIT = 150 * 1024;
		const { page, errors } = await start(browser, {
			stored: { settings: { addons: ['convert'] }, currentQueue: null },
			writes: true,
			allow: /^https:\/\/unpkg\.com\//
		});
		await page.evaluate(
			(limit) =>
				localStorage.setItem(
					'stosufy-convert-options',
					JSON.stringify({ quality: 'balanced', maxBytes: limit })
				),
			LIMIT
		);
		row = (name) => page.locator(`li[aria-label="${name}"]`).last();
		await page.click('header button[aria-label="File converter"]');
		await page.waitForURL('**/addons/convert');
		// 20 s of noise (~860 KB): an MP3 of it at 192 kbit/s would be ~470 KB
		const noise = Buffer.from(wav());
		const long = Buffer.alloc(44 + 22050 * 2 * 20);
		noise.copy(long, 0, 0, 44);
		long.writeUInt32LE(36 + 22050 * 2 * 20, 4);
		long.writeUInt32LE(22050 * 2 * 20, 40);
		for (let i = 44; i < long.length; i += 2)
			long.writeInt16LE(Math.round((Math.random() - 0.5) * 30000), i);
		await page.setInputFiles('input[aria-label="Choose files"]', [
			{ name: 'noise.wav', mimeType: 'audio/wav', buffer: long },
			{ name: 'noise-flac.wav', mimeType: 'audio/wav', buffer: long },
			{ name: 'big.png', mimeType: 'image/png', buffer: png },
			{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: clip },
			{ name: 'tiny.png', mimeType: 'image/png', buffer: TINY }
		]);
		await page.waitForSelector('li[aria-label="clip.mp4"]');
		check(
			'with a size limit: its own format first, to make it smaller',
			(await offered(row('clip.mp4')))[0] === 'mp4' &&
				/Smaller MP4/.test(await row('clip.mp4').locator('[data-target="mp4"]').innerText())
		);
		await pick(row('noise.wav'), 'mp3');
		await pick(row('noise-flac.wav'), 'flac');
		await pick(row('big.png'), 'png');
		await pick(row('clip.mp4'), 'mp4');
		await pick(row('tiny.png'), 'png');
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('ul[aria-label="Files"] > li')].every((li) =>
					['done', 'failed'].includes(li.dataset.status)
				),
			null,
			{ timeout: 120000 }
		);
		const sizes = await page.evaluate(() =>
			Object.fromEntries(
				Object.entries(window.__written).map(([name, data]) => [name.split('/').pop(), data.length])
			)
		);
		check(
			'a 20 s WAV → MP3 under 150 KB (a lower bitrate)',
			sizes['noise.mp3'] <= LIMIT && sizes['noise.mp3'] > 60 * 1024,
			JSON.stringify(sizes)
		);
		check(
			'a 638 KB PNG → a smaller PNG under 150 KB',
			sizes['big.png'] <= LIMIT,
			JSON.stringify(sizes)
		);
		check('a smaller MP4 under it', sizes['clip.mp4'] <= LIMIT, JSON.stringify(sizes));
		check(
			'already under it: kept as it was, and said so',
			sizes['tiny.png'] === TINY.length &&
				/Already under 150 KB: kept as it was/.test(await row('tiny.png').innerText()),
			`${sizes['tiny.png']}: ${await row('tiny.png').innerText()}`
		);
		check(
			"FLAC can't be made smaller: it says so",
			/FLAC can't be made smaller/.test(await row('noise-flac.wav').innerText())
		);
		check('no errors (size limit)', errors.length === 0, errors.join('\n'));
		await page.context().close();
	}

	// --- From the file picker, a word when it's done, dragged out ----------------------------
	{
		const { page, errors } = await start(browser, {
			stored: { settings: { addons: ['convert'] }, currentQueue: null },
			writes: true,
			allow: /^https:\/\/unpkg\.com\//
		});
		row = (name) => page.locator(`li[aria-label="${name}"]`).last();
		const tone = Array.from(wav());
		await page.evaluate(
			({ tone, png }) => {
				window.__pickable = [
					{ path: '/home/tester/Music/a.wav', name: 'a.wav', size: tone.length },
					{ path: '/home/tester/Music/b.wav', name: 'b.wav', size: tone.length },
					{ path: '/home/tester/Pictures/p.png', name: 'p.png', size: png.length }
				];
				window.__pickBytes = {
					'/home/tester/Music/a.wav': tone,
					'/home/tester/Music/b.wav': tone,
					'/home/tester/Pictures/p.png': png
				};
				// (the app not in front, and the system's notifications)
				window.__notified = [];
				document.hasFocus = () => false;
				window.Notification = class {
					static permission = 'granted';
					constructor(title, options) {
						window.__notified.push([title, options?.body]);
					}
				};
			},
			{ tone, png: Array.from(png) }
		);
		await page.click('header button[aria-label="File converter"]');
		await page.click('button:has-text("Drop files here")');
		await page.waitForSelector('li[aria-label="p.png"]');
		check(
			"the system's file picker: its files in the list",
			(await page.locator('ul[aria-label="Files"] > li').count()) === 3
		);
		const readFirst = await page.evaluate(() => window.__read ?? []);
		check(
			'a picture is read right away, songs only when they are converted',
			JSON.stringify(readFirst) === JSON.stringify(['/home/tester/Pictures/p.png']),
			JSON.stringify(readFirst)
		);
		check(
			'a picked song shows its size on disk',
			/WAV · 43 KB/.test(await row('a.wav').innerText())
		);
		await pick(row('a.wav'), 'mp3');
		await pick(row('b.wav'), 'mp3');
		await pick(row('p.png'), 'jpg');
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('ul[aria-label="Files"] > li')].every(
					(li) => li.dataset.status === 'done'
				),
			null,
			{ timeout: 120000 }
		);
		check(
			'converted from where they are',
			(await page.evaluate(() => window.__read)).includes('/home/tester/Music/a.wav')
		);
		await page.waitForFunction(() => window.__notified.length);
		const notified = await page.evaluate(() => window.__notified);
		check(
			'done while the app is behind: a notification',
			JSON.stringify(notified) ===
				JSON.stringify([['3 files converted', 'Ready in Stosufy/Converted']]),
			JSON.stringify(notified)
		);
		const result = row('a.wav').locator('button:has-text("a.mp3")');
		const box = await result.boundingBox();
		await page.mouse.move(box.x + 10, box.y + 10);
		await page.mouse.down();
		await page.mouse.move(box.x + 30, box.y + 30, { steps: 4 });
		await page.mouse.up();
		check(
			'dragged out: the file itself',
			JSON.stringify(await page.evaluate(() => window.__dragged)) ===
				JSON.stringify(['/home/tester/Stosufy/Converted/a.mp3'])
		);
		check(
			'…and not shown in its folder (no click)',
			!(await page.evaluate(() => window.__revealed))
		);
		check('no errors (picker)', errors.length === 0, errors.join('\n'));
		await page.context().close();
	}
	await browser.close();

	console.log(`\n${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
