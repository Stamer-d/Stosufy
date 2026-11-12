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

/** A file's row in the list */
let row;
/** Its format clicked: a button, or in "More" */
async function pick(at, target) {
	const button = at.locator(`button[data-target="${target}"]`);
	if (await button.count()) await button.first().click();
	else await at.locator('select[aria-label="More formats"]').selectOption(target);
}

(async () => {
	const zip = new JSZip();
	zip.file('notes/hello.txt', 'hello');
	zip.file('../escape.txt', 'kept inside');
	const png = fs.readFileSync(path.join(root, 'static', 'logo.png'));
	const clip = fs.readFileSync(path.join(__dirname, 'fixtures', 'clip.mp4'));
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

	await page.setInputFiles(
		'input[aria-label="Choose files"]',
		FILES.map(([file]) => file)
	);
	await page.waitForSelector(`li[aria-label="${FILES.at(-1)[0].name}"]`);
	check(
		'every file is in the list',
		(await page.locator('ul[aria-label="Files"] > li').count()) === FILES.length
	);
	const offered = (row) =>
		row.evaluate((li) => [
			...[...li.querySelectorAll('[data-target]')].map((button) => button.dataset.target),
			...[...li.querySelectorAll('select option')].map((option) => option.value).filter(Boolean)
		]);
	const data = await offered(row('data.json'));
	check(
		'a JSON can become YAML, TOML, CSV, XML…',
		['yaml', 'toml', 'csv', 'tsv', 'xml', 'zip'].every((id) => data.includes(id)),
		data.join()
	);
	const video = await offered(row('clip.mp4'));
	check(
		'an MP4: MP3 first, then GIF, WebM…',
		video.slice(0, 3).join() === 'mp3,gif,webm',
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
	check('any file → Base64', asText('blob.txt') === 'YWJj\n');
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
			{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: clip }
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
			"FLAC can't be made smaller: it says so",
			/FLAC can't be made smaller/.test(await row('noise-flac.wav').innerText())
		);
		check('no errors (size limit)', errors.length === 0, errors.join('\n'));
		await page.context().close();
	}
	await browser.close();

	console.log(`\n${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
