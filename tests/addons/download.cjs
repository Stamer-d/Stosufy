// The downloader: a link looked at (yt-dlp mocked, see harness.cjs), its formats and qualities
// to choose from (each codec's own), a YouTube video's sound as MP3 at 192 kbps (YouTube's
// support fetched for it), what was chosen kept for the next link, a part of a Twitch VOD, a
// playlist's first video, a link that needs signing in, a download stopped, and on to the
// editor and the converter.
const { chromium, start } = require('./harness.cjs');

const results = [];
function check(name, ok, detail = '') {
	results.push(ok);
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
}

const YOUTUBE = 'https://www.youtube.com/watch?v=abc123';
const TWITCH = 'https://www.twitch.tv/videos/2385736857';
/** A link to a time in it (where it starts) */
const TWITCH_AT = `${TWITCH}?t=1h00m00s`;
const PLAYLIST = 'https://www.youtube.com/playlist?list=PL1';
const PRIVATE = 'https://www.youtube.com/watch?v=members';
const SLOW = 'https://soundcloud.com/someone/slow';
const MB = 1024 * 1024;
const formats = (vcodec, heights, fps = 30) =>
	heights.map((height) => ({ height, fps, vcodec, acodec: 'none', filesize: height * 50_000 }));

(async () => {
	const browser = await chromium.launch();
	const { page, errors } = await start(browser, {
		stored: { settings: { addons: ['download', 'edit', 'convert'] }, currentQueue: null },
		writes: true
	});
	await page.evaluate(
		({ YOUTUBE, TWITCH, TWITCH_AT, PLAYLIST, PRIVATE, SLOW, yt, tw }) => {
			window.__ffmpegStatus = {
				supported: true,
				installed: true,
				downloadSize: 0,
				workDir: '/home/tester/Stosufy/tmp/media'
			};
			// (a link on the clipboard, offered when the page opens)
			window.__clipboardLink = YOUTUBE;
			window.__ytdlp = {
				status: { supported: true, installed: true, denoSupported: true, denoInstalled: false },
				slow: SLOW,
				infos: {
					[YOUTUBE]: {
						_type: 'video',
						title: 'Test song',
						uploader: 'Someone',
						duration: 215,
						extractor_key: 'Youtube',
						webpage_url: YOUTUBE,
						formats: yt
					},
					[TWITCH]: {
						_type: 'video',
						title: 'Long stream',
						uploader: 'streamer',
						duration: 3 * 3600 + 120,
						extractor_key: 'TwitchVod',
						webpage_url: TWITCH,
						formats: tw
					},
					[PLAYLIST]: {
						_type: 'playlist',
						title: 'Mix',
						extractor_key: 'YoutubeTab',
						webpage_url: PLAYLIST,
						playlist_count: 30,
						entries: [{ title: 'a' }, { title: 'b' }, { title: 'c' }]
					},
					[PRIVATE]: {
						_type: 'video',
						title: 'Members video',
						duration: 60,
						extractor_key: 'Youtube',
						webpage_url: PRIVATE,
						formats: yt
					},
					[SLOW]: {
						_type: 'video',
						title: 'Slow one',
						duration: 100,
						extractor_key: 'Soundcloud',
						webpage_url: SLOW,
						formats: [{ vcodec: 'none', acodec: 'mp3', filesize: 2_000_000 }]
					}
				},
				errors: { [PRIVATE]: 'Only for members of the channel: sign in to download it' },
				// (a browser that locks its sign-in)
				locked: ['chrome'],
				unlocks: { [PRIVATE]: 'firefox' },
				notes: { [PLAYLIST]: '2 of its videos are private' }
			};
		},
		{
			YOUTUBE,
			TWITCH,
			TWITCH_AT,
			PLAYLIST,
			PRIVATE,
			SLOW,
			yt: [
				...formats('avc1.64001F', [360, 720]),
				...formats('avc1.640028', [1080], 60),
				...formats('vp09.00.40.08', [1440, 1080, 480]),
				...formats('av01.0.08M.08', [1080]),
				{ vcodec: 'none', acodec: 'opus', filesize: 3 * MB }
			],
			tw: formats('avc1.4D401F', [160, 480, 720, 1080])
		}
	);
	const requests = () => page.evaluate(() => window.__ytdlp.requests ?? []);
	const link = async (url) => {
		await page.fill('input[aria-label="Link"]', url);
		await page.press('input[aria-label="Link"]', 'Enter');
	};
	const row = (title) => page.locator(`ul[aria-label="Downloads"] > li[aria-label="${title}"]`);
	const dropdown = (label) => page.locator(`[role="combobox"][aria-label^="${label}:"]`);
	/** The options of a dropdown (opened and closed again) */
	const optionsOf = async (label) => {
		await dropdown(label).click();
		const list = page.locator(`[role="listbox"][aria-label="${label}"] [role="option"]`);
		const all = [];
		for (let i = 0; i < (await list.count()); i++)
			all.push((await list.nth(i).innerText()).replace(/\s+/g, ' ').trim());
		await page.keyboard.press('Escape');
		return all;
	};
	const choose = async (label, value) => {
		await dropdown(label).click();
		await page.click(
			`[role="listbox"][aria-label="${label}"] [role="option"][data-value="${value}"]`
		);
	};
	const shown = async (label) => (await dropdown(label).innerText()).replace(/\s+/g, ' ').trim();
	const tab = (name) =>
		page.locator(`[role="radiogroup"][aria-label="What"] [role="radio"]:has-text("${name}")`);

	await page.click('header button[aria-label="Downloader"]');
	await page.waitForURL('**/addons/download');
	await page.waitForSelector('text=Paste a link to start');
	check('its page: a field for the link', true);

	// --- A YouTube video (the link on the clipboard): its formats, qualities, sound as MP3 ----
	const offer = page.locator('[role="group"][aria-label="Link on the clipboard"]');
	await offer.waitFor();
	check(
		'a link on the clipboard: offered, not used yet',
		/youtube\.com\/watch\?v=abc123/.test(await offer.innerText()) &&
			(await page.inputValue('input[aria-label="Link"]')) === ''
	);
	await offer.locator('button:has-text("Use it")').click();
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
	const what = await page.locator('section[aria-label="What it is"]').innerText();
	check(
		'what it is: its site, channel and length',
		/youtube/i.test(what) && /Someone · 3:35/.test(what),
		what
	);
	check(
		'YouTube support fetched for a YouTube link',
		(await page.evaluate(() => window.__ytdlp.denoInstalls)) === 1
	);
	check(
		'Video and Sound as two tabs, Video first',
		(await tab('Video').getAttribute('aria-checked')) === 'true'
	);
	const codecs = (await optionsOf('Video format')).map((text) =>
		text.split(' ').slice(0, 3).join(' ')
	);
	check(
		'every codec it has, to choose (and the best of all, as MKV)',
		JSON.stringify(codecs) ===
			JSON.stringify(['MP4 · H.264', 'MP4 · AV1', 'WebM · VP9', 'MKV · Best']),
		JSON.stringify(codecs)
	);
	check(
		'H.264 chosen at first (plays everywhere)',
		/MP4 · H\.264/.test(await shown('Video format'))
	);
	const h264 = await optionsOf('Quality');
	check(
		"H.264's qualities, the best first, with 60 fps and how big",
		/^Best/.test(h264[0]) &&
			/^1080p60 .*≈ 5\d MB/.test(h264[1]) &&
			/^720p/.test(h264[2]) &&
			/^360p/.test(h264[3]) &&
			h264.length === 4,
		JSON.stringify(h264)
	);
	await choose('Video format', 'vp9');
	const vp9 = (await optionsOf('Quality')).map((text) => text.split(' ')[0]);
	check(
		'another codec: its own qualities',
		JSON.stringify(vp9) === JSON.stringify(['Best', '1440p', '1080p', '480p']),
		JSON.stringify(vp9)
	);
	check(
		'the download button says how big',
		/Download ≈ \d+ MB/.test(
			(
				await page
					.locator('section[aria-label="What it is"] button:has-text("Download")')
					.innerText()
			).replace(/\s+/g, ' ')
		)
	);
	// (the arrow keys too, as with radio buttons)
	await tab('Video').focus();
	await page.keyboard.press('ArrowRight');
	check(
		'Video or Sound: the arrow keys choose',
		(await tab('Sound').getAttribute('aria-checked')) === 'true' &&
			(await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Sound'
	);
	await page.keyboard.press('ArrowLeft');
	await tab('Sound').click();
	const sounds = (await optionsOf('Sound format')).map((text) => text.split(' ')[0]);
	check(
		'sound formats, to choose',
		JSON.stringify(sounds) === JSON.stringify(['MP3', 'M4A', 'Opus', 'FLAC', 'WAV', 'Original']),
		JSON.stringify(sounds)
	);
	await choose('Sound format', 'mp3');
	const kbps = (await optionsOf('Sound quality')).map((text) =>
		text.split(' ').slice(0, 2).join(' ')
	);
	check(
		"MP3's bitrates, to choose",
		JSON.stringify(kbps) ===
			JSON.stringify(['Best as', '320 kbps', '256 kbps', '192 kbps', '128 kbps']),
		JSON.stringify(kbps)
	);
	await choose('Sound quality', '192');
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Test song').locator('text=Test song.mp3').waitFor();
	const first = (await requests())[0];
	check(
		'asked for: its sound as MP3 at 192 kbps, sponsors out, just the video',
		first.kind === 'audio' &&
			first.format === 'mp3' &&
			first.audioKbps === 192 &&
			first.codec === null &&
			first.height === null &&
			first.sponsorblock === true &&
			first.playlist === false &&
			first.playlistItems === null &&
			first.sections.length === 0 &&
			first.cookies === null,
		JSON.stringify(first)
	);
	check(
		'the download says what it is',
		/YouTube · MP3 · 192 kbps/.test(await row('Test song').innerText()),
		await row('Test song').innerText()
	);
	check(
		'saved in Stosufy/Downloads',
		await page.evaluate(() => !!window.__written['/home/tester/Stosufy/Downloads/Test song.mp3'])
	);
	check(
		'the field empty again, for the next link',
		(await page.inputValue('input[aria-label="Link"]')) === ''
	);

	check('the link used: not offered again', (await offer.count()) === 0);
	// (another one copied, back in Stosufy: offered; "Not this link": gone)
	await page.evaluate((url) => {
		window.__clipboardLink = url;
		window.dispatchEvent(new Event('focus'));
	}, TWITCH_AT);
	await offer.waitFor();
	await offer.locator('button[aria-label="Not this link"]').click();
	await offer.waitFor({ state: 'detached' });
	check('another link copied: offered; "Not this link": gone', true);

	// --- A part of a Twitch VOD (a link to an hour in): what was chosen kept -----------------
	// (yt-dlp's answer for it: the video's, its own address without the time)
	await page.evaluate(({ at, plain }) => (window.__ytdlp.infos[at] = window.__ytdlp.infos[plain]), {
		at: TWITCH_AT,
		plain: TWITCH
	});
	await link(TWITCH_AT);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Long stream")');
	check(
		'Twitch: no YouTube support needed',
		(await page.evaluate(() => window.__ytdlp.denoInstalls)) === 1
	);
	check(
		'the last choice kept (the sound, as MP3 at 192 kbps)',
		(await tab('Sound').getAttribute('aria-checked')) === 'true' &&
			/^MP3/.test(await shown('Sound format')) &&
			/^192 kbps/.test(await shown('Sound quality'))
	);
	await tab('Video').click();
	check(
		"a codec it doesn't have (VP9): the first it has",
		/MP4 · H\.264/.test(await shown('Video format')),
		await shown('Video format')
	);
	await choose('Quality', '720');
	check(
		'a link to a time in it: only a part, from there',
		(await page.locator('button[aria-pressed="true"]:has-text("Only a part")').count()) === 1 &&
			/^1:00:00/.test(await page.inputValue('input[aria-label="Part start time"]')),
		await page.inputValue('input[aria-label="Part start time"]')
	);
	check(
		'a part: cut at the keyframes at first (fast, as good as the original)',
		(await page.getAttribute('button:has-text("Exact cut")', 'aria-pressed')) === 'false'
	);
	await page.click('button:has-text("Exact cut")');
	await page.fill('input[aria-label="Part end time"]', '1:05:00');
	await page.press('input[aria-label="Part end time"]', 'Enter');
	check('the part shown: 5 minutes', (await page.locator('text=5:00 of 3:02:00').count()) === 1);
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Long stream').locator('text=Long stream.mp4').waitFor();
	const second = (await requests())[1];
	check(
		'asked for: 1:00:00–1:05:00, cut exactly, as a 720p H.264 MP4',
		JSON.stringify(second.sections) === '[[3600,3900]]' &&
			second.exactCuts === true &&
			second.kind === 'video' &&
			second.format === 'mp4' &&
			second.codec === 'h264' &&
			second.height === 720 &&
			second.audioKbps === null &&
			second.sponsorblock === false,
		JSON.stringify(second)
	);
	check(
		'the download says what it is',
		/Twitch · MP4 · H\.264 · 720p · 1:00:00–1:05:00/.test(await row('Long stream').innerText()),
		await row('Long stream').innerText()
	);

	// --- Back on YouTube: VP9 chosen there last (Twitch has none), 720p the highest under it ---
	await link(YOUTUBE);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
	check(
		'the codec chosen there last kept: VP9; it has no 720p, the highest under it',
		/WebM · VP9/.test(await shown('Video format')) && /^480p/.test(await shown('Quality')),
		`${await shown('Video format')} / ${await shown('Quality')}`
	);
	await choose('Video format', 'h264');
	check(
		'H.264 again: 720p, as chosen last',
		/^720p/.test(await shown('Quality')),
		await shown('Quality')
	);

	// --- A playlist, a video for members -----------------------------------------------------
	await link(PLAYLIST);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Mix")');
	const which = await optionsOf('Which videos');
	check(
		'a playlist: all of its videos, or the first few',
		JSON.stringify(which) ===
			JSON.stringify(['All 30 videos', 'The first 10', 'The first 25', 'Only the first']),
		JSON.stringify(which)
	);
	check(
		"a playlist's codecs: all of them (not known one by one)",
		(await optionsOf('Video format')).length === 5
	);
	await choose('Which videos', '1');
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Mix').locator('text=Mix.mp4').waitFor();
	const third = (await requests())[2];
	check(
		"asked for: the playlist's first video",
		third.playlist === true && third.playlistItems === '1' && third.codec === 'h264',
		JSON.stringify(third)
	);
	check(
		'in a folder of its own, and what went wrong with some said',
		(await page.evaluate(() => !!window.__written['/home/tester/Stosufy/Downloads/Mix/Mix.mp4'])) &&
			/2 of its videos are private/.test(await row('Mix').innerText()) &&
			/the first video/.test(await row('Mix').innerText()),
		await row('Mix').innerText()
	);
	await link(PRIVATE);
	await page.waitForSelector('text=Only for members of the channel');
	check("a link that can't be: says why", true);
	const browsers = await optionsOf('Signed in as');
	check(
		'browsers to sign in as (no Safari but on a Mac)',
		browsers[0].startsWith('Not signed in') &&
			browsers.some((text) => text.startsWith('As in Firefox')) &&
			!browsers.some((text) => /Safari/.test(text)),
		JSON.stringify(browsers)
	);
	await choose('Signed in as', 'firefox');
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Members video")');
	check(
		'signed in: looked at again, as in Firefox',
		(await page.evaluate(() => window.__ytdlp.looked.at(-1).cookies)) === 'firefox'
	);
	// A browser whose sign-in can't be read: looked at without it, said so
	await choose('Signed in as', 'chrome');
	await link(YOUTUBE);
	await page.waitForSelector("text=Chrome's sign-in couldn't be read: without it");
	const tries = (await page.evaluate(() => window.__ytdlp.looked.slice(-2))).map((t) => t.cookies);
	check(
		"a browser's sign-in that can't be read: looked at without it, said so",
		JSON.stringify(tries) === '["chrome",null]',
		JSON.stringify(tries)
	);
	// A cookies file exported from a browser: added, signed in with it, forgotten
	await page.evaluate(() => {
		window.__cookiesToAdd = { count: 12, youtube: true, added: 1794500000 };
	});
	await choose('Signed in as', 'add-file');
	await page.waitForSelector('text=Cookies added: signed in with them');
	check(
		'a cookies file added: signed in with it',
		/Cookies file/.test(await shown('Signed in as')),
		await shown('Signed in as')
	);
	await link(TWITCH);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Long stream")');
	check(
		'…looked at with it',
		(await page.evaluate(() => window.__ytdlp.looked.at(-1).cookies)) === 'file'
	);
	const fileOptions = await optionsOf('Signed in as');
	check(
		'…to be forgotten, or another one added',
		fileOptions.some((text) => text.startsWith('Cookies file 12 cookies')) &&
			fileOptions.some((text) => text.startsWith('Another cookies file')) &&
			fileOptions.some((text) => text.startsWith('Forget the cookies file')),
		JSON.stringify(fileOptions)
	);
	await choose('Signed in as', 'forget-file');
	check(
		'forgotten: not signed in',
		/Not signed in/.test(await shown('Signed in as')) &&
			(await page.evaluate(() => window.__cookies)) === null
	);
	await choose('Signed in as', 'firefox');

	// --- Only sound, stopped -----------------------------------------------------------------
	await link(SLOW);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Slow one")');
	check(
		'only sound there: no video to choose',
		(await tab('Video').isDisabled()) &&
			(await tab('Sound').getAttribute('aria-checked')) === 'true'
	);
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Slow one').waitFor();
	const fourth = (await requests())[3];
	check('signed in as in Firefox', fourth.cookies === 'firefox' && fourth.kind === 'audio');
	await page.click('button[aria-label="Stop Slow one"]');
	await row('Slow one').waitFor({ state: 'detached' });
	check('stopped: off the list', true);
	await link(YOUTUBE);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
	check(
		'a link with only sound changes no choice: Video again for a video',
		(await tab('Video').getAttribute('aria-checked')) === 'true'
	);

	// --- Remembered when the page is opened again --------------------------------------------
	const kept = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('stosufy-download-options') ?? '{}')
	);
	check(
		'kept: video, H.264, 720p, MP3 at 192 kbps, exact cuts, Firefox',
		kept.tab === 'video' &&
			kept.exactCuts === true &&
			kept.codec === 'h264' &&
			kept.height === 720 &&
			kept.audioFormat === 'mp3' &&
			kept.audioKbps === 192 &&
			kept.cookies === 'firefox',
		JSON.stringify(kept)
	);

	// --- On to the editor and the converter --------------------------------------------------
	await row('Test song').locator('button:has-text("Edit")').click();
	await page.waitForURL('**/addons/edit');
	await page.waitForSelector('h2:has-text("Test song.mp3")');
	check('"Edit": in the file editor', true);
	await page.click('header button[aria-label="Downloader"]');
	await row('Long stream').locator('button:has-text("Convert")').click();
	await page.waitForURL('**/addons/convert');
	await page.waitForSelector('li[aria-label="Long stream.mp4"]');
	check('"Convert": in the converter', true);
	check('no errors', errors.length === 0, errors.join('\n'));

	// --- Kept for next time: what was downloading, stopped; files gone, said so -------------
	await page.click('header button[aria-label="Downloader"]');
	await link(SLOW);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Slow one")');
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Slow one').waitFor();
	await page.waitForTimeout(500);
	// (Stosufy opened again: its files are gone too, as the mock forgets them)
	await page.reload();
	await page.waitForSelector('header button[aria-label="Downloader"]', { timeout: 60000 });
	await page.click('header button[aria-label="Downloader"]');
	await row('Slow one').waitFor();
	check(
		'opened again: the downloads still there',
		(await row('Test song').count()) === 1 && (await row('Mix').count()) === 1
	);
	check(
		'what was downloading: stopped, to try again',
		/Stopped when Stosufy was closed/.test(await row('Slow one').innerText()) &&
			(await row('Slow one').locator('button:has-text("Try again")').count()) === 1,
		await row('Slow one').innerText()
	);
	await row('Test song').locator('text=Moved or deleted').waitFor();
	check(
		'a file not there any more: said so, to download again',
		(await row('Test song').locator('button:has-text("Download again")').count()) === 1
	);

	await browser.close();
	console.log(`\n${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
