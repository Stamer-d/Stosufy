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
		'every codec it has, to choose (and the best of all: as MKV, and for Premiere)',
		JSON.stringify(codecs) ===
			JSON.stringify(['MP4 · H.264', 'MP4 · AV1', 'WebM · VP9', 'MKV · Best', 'MP4 for Premiere']),
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
	// (what yt-dlp does, told while it looks)
	await page.evaluate(() => {
		window.__ytdlp.lookSteps = ['open', 'page', 'formats'];
		window.__ytdlp.stepDelay = 400;
	});
	await link(TWITCH_AT);
	const looking = page.locator('ol[aria-label="Looking at the link"]');
	// (polled: there for only a moment)
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('ol[aria-label="Looking at the link"] li')].some((li) =>
				li.textContent.includes('Loading the page')
			),
		null,
		{ polling: 50 }
	);
	check(
		'looking at a link: what it does now, and what it did',
		/Opening the link\s+Loading the page…/.test(await looking.innerText()),
		await looking.innerText()
	);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Long stream")');
	await page.evaluate(() => (window.__ytdlp.lookSteps = null));
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
	// (what it does, told: started, then FFmpeg cutting the part, at half of it)
	await page.evaluate(() => {
		window.__ytdlp.progress = [
			{ phase: 'step', step: 'challenge' },
			{ phase: 'step', step: 'cut' },
			{ phase: 'cut', seconds: 150, speed: '2.5x' }
		];
		window.__ytdlp.hold = 1500;
	});
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Long stream').locator("text=Solving YouTube's check…").waitFor();
	check('downloading: what it does before, said', true);
	await row('Long stream').locator('text=Cutting out the part · 50% · 2.5× speed').waitFor();
	check(
		'a part cut out: how far, and how fast',
		(await row('Long stream').locator('[role="progressbar"]').getAttribute('aria-valuenow')) ===
			'50'
	);
	await page.evaluate(() => {
		window.__ytdlp.progress = null;
		window.__ytdlp.hold = 0;
	});
	await row('Long stream').locator('text=Long stream.mp4').waitFor();
	await page.click('button:has-text("Open folder")');
	check(
		'"Open folder": the Downloads folder opened (not shown in the one above)',
		(await page.evaluate(() => window.__opened)) === '/home/tester/Stosufy/Downloads',
		await page.evaluate(() => window.__opened)
	);
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
		(await optionsOf('Video format')).length === 6
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

	// --- For Premiere: the best there is, made an MP4 for editing right after; a part, as cut -
	{
		const { page: edit, errors: editErrors } = await start(browser, {
			stored: { settings: { addons: ['download'] }, currentQueue: null },
			writes: true
		});
		await edit.evaluate(
			({ YOUTUBE, TWITCH, yt, tw }) => {
				window.__ffmpegStatus = {
					supported: true,
					installed: true,
					downloadSize: 0,
					workDir: '/home/tester/Stosufy/tmp/media'
				};
				// (what FFmpeg says the download is: 1440p60 VP9 and Opus, 3:35)
				window.__ffmpeg = {
					hold: 400,
					probe: [
						"Input #0, matroska,webm, from 'in.mkv':",
						'  Duration: 00:03:35.00, start: 0.000000, bitrate: 9000 kb/s',
						'  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, bt709), 2560x1440, SAR 1:1 DAR 16:9, 60 fps, 60 tbr, 1k tbn (default)',
						'  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp (default)'
					].join('\n')
				};
				window.__ytdlp = {
					status: { supported: true, installed: true, denoSupported: true, denoInstalled: true },
					infos: {
						[YOUTUBE]: {
							_type: 'video',
							title: 'Test song',
							duration: 215,
							extractor_key: 'Youtube',
							webpage_url: YOUTUBE,
							formats: yt
						},
						[TWITCH]: {
							_type: 'video',
							title: 'Long stream',
							duration: 3 * 3600 + 120,
							extractor_key: 'TwitchVod',
							webpage_url: TWITCH,
							formats: tw
						}
					}
				};
			},
			{
				YOUTUBE,
				TWITCH,
				yt: [
					...formats('avc1.640028', [1080, 720], 60),
					...formats('vp09.00.50.08', [1440, 1080], 60)
				],
				tw: formats('avc1.4D401F', [1080, 720], 60)
			}
		);
		const box = (label) => edit.locator(`[role="combobox"][aria-label^="${label}:"]`);
		const editRow = (title) =>
			edit.locator(`ul[aria-label="Downloads"] > li[aria-label="${title}"]`);
		const pickIn = async (label, value) => {
			await box(label).click();
			await edit.click(
				`[role="listbox"][aria-label="${label}"] [role="option"][data-value="${value}"]`
			);
		};
		await edit.click('header button[aria-label="Downloader"]');
		await edit.waitForURL('**/addons/download');
		await edit.fill('input[aria-label="Link"]', YOUTUBE);
		await edit.press('input[aria-label="Link"]', 'Enter');
		await edit.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
		await pickIn('Video format', 'editing');
		await box('Quality').click();
		const heights = await edit
			.locator('[role="listbox"][aria-label="Quality"] [role="option"]')
			.allInnerTexts();
		await edit.keyboard.press('Escape');
		const section = await edit.locator('section[aria-label="What it is"]').innerText();
		check(
			'for Premiere: its best quality (1440p60, whatever the codec), no size guessed',
			/1440p60/.test(heights[1] ?? '') &&
				!heights.some((text) => /≈/.test(text)) &&
				/nothing to convert after/.test(section) &&
				!/≈/.test(
					await edit
						.locator('section[aria-label="What it is"] button:has-text("Download")')
						.innerText()
				),
			section
		);
		await edit.click('section[aria-label="What it is"] button:has-text("Download")');
		await editRow('Test song').locator('text=/Making it ready for Premiere/').waitFor();
		check('downloaded, then made ready for Premiere: said so, with how far', true);
		await editRow('Test song').locator('text=Test song.mp4').waitFor();
		const asked = await edit.evaluate(() => window.__ytdlp.requests[0]);
		check(
			'asked for: the best there is, whatever its codec, for editing',
			asked.editing === true &&
				asked.codec === 'any' &&
				asked.format === 'mp4' &&
				!asked.sections.length,
			JSON.stringify(asked)
		);
		const run = (await edit.evaluate(() => window.__ffmpeg.runs))[0].join(' ');
		check(
			'made an MP4 for editing: H.264 Baseline at its best, 60 fps steady, AAC at 48 kHz',
			/-preset ultrafast -x264-params aq-mode=1 -crf 16 -pix_fmt yuv420p/.test(run) &&
				/-fps_mode cfr -r 60 -g 120/.test(run) &&
				/-c:a aac -ar 48000/.test(run) &&
				run.endsWith('.mp4'),
			run
		);
		check(
			'saved as an MP4 in Stosufy/Downloads (not the MKV)',
			(await edit.evaluate(
				() => !!window.__written['/home/tester/Stosufy/Downloads/Test song.mp4']
			)) && /MP4 for Premiere/.test(await editRow('Test song').innerText()),
			await editRow('Test song').innerText()
		);
		// Stopped while it's made ready: off the list
		await edit.evaluate(() => (window.__ffmpeg.hold = 30000));
		await edit.fill('input[aria-label="Link"]', YOUTUBE + '&x=1');
		await edit.evaluate(
			(url) => (window.__ytdlp.infos[url] = window.__ytdlp.infos[url.split('&')[0]]),
			YOUTUBE + '&x=1'
		);
		await edit.press('input[aria-label="Link"]', 'Enter');
		await edit.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
		await edit.click('section[aria-label="What it is"] button:has-text("Download")');
		await edit
			.locator('ul[aria-label="Downloads"] > li >> text=/Making it ready for Premiere/')
			.waitFor();
		await edit
			.locator('ul[aria-label="Downloads"] > li')
			.first()
			.locator('button[aria-label^="Stop"]')
			.click();
		await edit.waitForFunction(
			() => document.querySelectorAll('ul[aria-label="Downloads"] > li').length === 1
		);
		check('stopped while made ready: off the list', true);
		// It couldn't be made ready: kept as downloaded, said so
		await edit.evaluate(() =>
			Object.assign(window.__ffmpeg, { hold: 0, fail: 'Error while decoding stream' })
		);
		await edit.fill('input[aria-label="Link"]', YOUTUBE + '&x=2');
		await edit.evaluate(
			(url) => (window.__ytdlp.infos[url] = window.__ytdlp.infos[url.split('&')[0]]),
			YOUTUBE + '&x=2'
		);
		await edit.press('input[aria-label="Link"]', 'Enter');
		await edit.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
		await edit.click('section[aria-label="What it is"] button:has-text("Download")');
		const kept = edit.locator('ul[aria-label="Downloads"] > li').first();
		await kept.locator("text=/Couldn't make it ready for Premiere/").waitFor();
		check(
			"couldn't be made ready: kept as downloaded, said so",
			(await kept.getAttribute('data-status')) === 'done' &&
				/Error while decoding stream/.test(await kept.innerText()),
			await kept.innerText()
		);
		// A part: at the keyframes (fast), made ready after; cut exactly, made ready as it's cut
		await edit.evaluate(() => (window.__ffmpeg.fail = ''));
		// (a link to an hour in: only the part from there)
		const at = `${TWITCH}?t=1h00m00s`;
		await edit.evaluate(
			(at) => (window.__ytdlp.infos[at] = window.__ytdlp.infos[at.split('?')[0]]),
			at
		);
		const exact = edit.locator('section[aria-label="What it is"] button:has-text("Exact cut")');
		const partOf = async () => {
			await edit.fill('input[aria-label="Link"]', at);
			await edit.press('input[aria-label="Link"]', 'Enter');
			await edit.waitForSelector('section[aria-label="What it is"] h2:has-text("Long stream")');
		};
		await partOf();
		check(
			'a part for Premiere: "Exact cut" to choose, off at first',
			(await exact.getAttribute('aria-pressed')) === 'false'
		);
		let runs = (await edit.evaluate(() => window.__ffmpeg.runs)).length;
		await edit.click('section[aria-label="What it is"] button:has-text("Download")');
		await editRow('Long stream').locator('text=Long stream.mp4').waitFor();
		let part = await edit.evaluate(() => window.__ytdlp.requests.at(-1));
		check(
			'a part for Premiere, not exactly: at the keyframes, made ready after',
			part.editing &&
				!part.exactCuts &&
				part.sections.length === 1 &&
				(await edit.evaluate(() => window.__ffmpeg.runs.length)) === runs + 1,
			JSON.stringify(part)
		);
		await partOf();
		await exact.click();
		runs = (await edit.evaluate(() => window.__ffmpeg.runs)).length;
		await edit.click('section[aria-label="What it is"] button:has-text("Download")');
		await edit.waitForFunction(() => window.__ytdlp.requests.length === 5);
		await edit
			.locator('ul[aria-label="Downloads"] > li')
			.first()
			.locator('text=/Long stream( \\(2\\))?\\.mp4/')
			.waitFor();
		part = await edit.evaluate(() => window.__ytdlp.requests.at(-1));
		check(
			'a part for Premiere, cut exactly: made ready as it is cut, nothing made again after',
			part.editing &&
				part.exactCuts &&
				(await edit.evaluate(() => window.__ffmpeg.runs.length)) === runs,
			JSON.stringify(part)
		);
		check('no errors (for Premiere)', editErrors.length === 0, editErrors.join('\n'));
		await edit.close();
	}

	// --- A download link: filled in, not started; a clip of several scenes, each on the list --
	{
		const { page: linked, errors: linkErrors } = await start(browser, {
			stored: { settings: { addons: ['download'] }, currentQueue: null },
			writes: true
		});
		const NOW = 'https://www.youtube.com/watch?v=abc123def45';
		const OLD = 'https://www.youtube.com/watch?v=old000strm1';
		await linked.evaluate(
			({ NOW, OLD, yt }) => {
				window.__ffmpegStatus = {
					supported: true,
					installed: true,
					downloadSize: 0,
					workDir: '/home/tester/Stosufy/tmp/media'
				};
				const video = (title, url, duration) => ({
					_type: 'video',
					title,
					duration,
					extractor_key: 'Youtube',
					webpage_url: url,
					formats: yt
				});
				window.__ytdlp = {
					status: { supported: true, installed: true, denoSupported: true, denoInstalled: true },
					infos: { [NOW]: video('Stream today', NOW, 7200), [OLD]: video('Old stream', OLD, 5400) }
				};
			},
			{ NOW, OLD, yt: formats('avc1.640028', [1080, 720], 60) }
		);
		const open = (url) =>
			linked.evaluate((url) => window.__emit('deep-link://new-url', [url]), url);
		const rows = linked.locator('ul[aria-label="Downloads"] > li');
		const asked = () => linked.evaluate(() => window.__ytdlp.requests ?? []);
		await linked.waitForSelector('header button[aria-label="Downloader"]', { timeout: 60000 });

		// One part, by its video's id and h:mm:ss: filled in, the page opened, nothing started
		await open(
			`stosufynew://download?video=abc123def45&startTime=0:01:39&endTime=0:01:57&title=${encodeURIComponent('Big fail')}`
		);
		await linked.waitForURL('**/addons/download');
		await linked.waitForSelector('section[aria-label="What it is"] h2:has-text("Stream today")');
		await linked.waitForFunction(
			() =>
				document.querySelector('section[aria-label="What it is"] input[maxlength="200"]')?.value ===
				'Big fail'
		);
		check(
			'a link: its video, part and name filled in, not downloaded',
			(await linked
				.locator(
					'section[aria-label="What it is"] button[aria-pressed="true"]:has-text("Only a part")'
				)
				.count()) === 1 && (await asked()).length === 0
		);

		// Several scenes (one from an older stream): each its own download, numbered, not started
		const scenes = 'abc123def45:99-117,old000strm1:3264-3287,abc123def45:200-215.5';
		await open(
			`stosufynew://download?url=&start=&end=&title=${encodeURIComponent('Flashback clip')}&scenes=${encodeURIComponent(scenes)}`
		);
		await linked.waitForFunction(
			() =>
				document.querySelectorAll('ul[aria-label="Downloads"] > li[data-status="ready"]').length ===
				3
		);
		const names = await rows.evaluateAll((all) => all.map((li) => li.getAttribute('aria-label')));
		check(
			'scenes: each on the list, named with its number, in order',
			JSON.stringify(names) === '["Flashback clip 1","Flashback clip 2","Flashback clip 3"]',
			JSON.stringify(names)
		);
		check('scenes: none started by itself', (await asked()).length === 0);
		check(
			'scenes: each says its part',
			/1:39–1:57/.test(await rows.nth(0).innerText()) &&
				/54:24–54:47/.test(await rows.nth(1).innerText()),
			await rows.nth(1).innerText()
		);
		check(
			'scenes: "Download all 3" to start them',
			(await linked.locator('button:has-text("Download all 3")').count()) === 1
		);
		// One started by hand: only that one, only its part
		await rows.nth(1).locator('button:has-text("Download")').click();
		await linked.waitForFunction(() => (window.__ytdlp.requests ?? []).length === 1);
		const second = (await asked())[0];
		check(
			'a scene started: only it, only its part, from its own video, with its name',
			second.url === OLD &&
				JSON.stringify(second.sections) === '[[3264,3287]]' &&
				second.fileName === 'Flashback clip 2',
			JSON.stringify(second)
		);
		// "Change": filled in above, off the list
		await rows.nth(2).locator('button:has-text("Change")').click();
		await linked.waitForFunction(
			() =>
				document.querySelector('section[aria-label="What it is"] input[maxlength="200"]')?.value ===
				'Flashback clip 3'
		);
		check(
			'"Change": the scene filled in above, off the list',
			(await linked
				.locator('ul[aria-label="Downloads"] > li[aria-label="Flashback clip 3"]')
				.count()) === 0
		);
		await linked.locator('button:has-text("Download all")').waitFor({ state: 'detached' });
		await rows
			.filter({ hasText: 'Flashback clip 1' })
			.locator('button:has-text("Download")')
			.click();
		await linked.waitForFunction(() => (window.__ytdlp.requests ?? []).length === 2);
		check(
			'the other started too: the first scene',
			JSON.stringify((await asked())[1].sections) === '[[99,117]]'
		);
		// A link whose scenes are wrong: said so, nothing on the list
		const before = await rows.count();
		await open('stosufynew://download?title=x&scenes=abc123def45:50-40');
		await linked.waitForSelector('text=/scene 1 ends before it starts/');
		check('wrong scenes: said so, nothing added', (await rows.count()) === before);
		check('no errors (links)', linkErrors.length === 0, linkErrors.join('\n'));
		await linked.close();
	}

	// --- The first time: all it needs downloaded at once, as soon as it's installed ----------
	{
		const { page: fresh, errors: freshErrors } = await start(browser, {
			stored: { settings: { addons: [] }, currentQueue: null },
			writes: true
		});
		await fresh.evaluate(() => {
			window.__ffmpegStatus = {
				supported: true,
				installed: true,
				downloadSize: 0,
				workDir: '/home/tester/Stosufy/tmp/media'
			};
			window.__ytdlp = {
				status: { supported: true, installed: false, denoSupported: true, denoInstalled: false },
				installDelay: 1500,
				infos: {},
				errors: {}
			};
		});
		await fresh.click('header button[aria-label="Add-ons"]');
		await fresh.waitForURL('**/addons');
		await fresh
			.locator('article[aria-label="Downloader"]')
			.locator('button:has-text("Install")')
			.click();
		// (opened while it gets ready)
		await fresh.locator('article[aria-label="Downloader"] button:has-text("Open")').click();
		await fresh.waitForURL('**/addons/download');
		await fresh.waitForSelector('text=Getting ready, the first time only');
		check('the first time: getting ready, said so with how far', true);
		await fresh.waitForFunction(() => window.__ytdlp.installs?.deno_install?.end, null, {
			timeout: 15000
		});
		const installs = await fresh.evaluate(() => window.__ytdlp.installs);
		check(
			'yt-dlp and YouTube support downloaded at once (from the install on)',
			installs.ytdlp_install &&
				installs.deno_install &&
				installs.deno_install.start < installs.ytdlp_install.end &&
				installs.ytdlp_install.start < installs.deno_install.end,
			JSON.stringify(installs)
		);
		await fresh.waitForSelector('text=Getting ready, the first time only', { state: 'detached' });
		check('ready: the note gone', true);
		check('no errors (the first time)', freshErrors.length === 0, freshErrors.join('\n'));
		await fresh.context().close();
	}

	await browser.close();
	console.log(`\n${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
