// The downloader: a link looked at (yt-dlp mocked, see harness.cjs), a YouTube video's sound
// as MP3 (YouTube's support fetched for it), a part of a Twitch VOD as a 720p MP4, a link that
// can't be, signed in as in a browser, a download stopped, and on to the editor and the
// converter.
const { chromium, start } = require('./harness.cjs');

const results = [];
function check(name, ok, detail = '') {
	results.push(ok);
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
}

const YOUTUBE = 'https://www.youtube.com/watch?v=abc123';
const TWITCH = 'https://www.twitch.tv/videos/2385736857';
const PLAYLIST = 'https://www.youtube.com/playlist?list=PL1';
const PRIVATE = 'https://www.youtube.com/watch?v=private';
const SLOW = 'https://soundcloud.com/someone/slow';
const formats = (heights) => heights.map((height) => ({ height, vcodec: 'avc1.64001F' }));

(async () => {
	const browser = await chromium.launch();
	const { page, errors } = await start(browser, {
		stored: { settings: { addons: ['download', 'edit', 'convert'] }, currentQueue: null },
		writes: true
	});
	await page.evaluate(
		({ YOUTUBE, TWITCH, PLAYLIST, PRIVATE, SLOW, yt, tw }) => {
			window.__ffmpegStatus = {
				supported: true,
				installed: true,
				downloadSize: 0,
				workDir: '/home/tester/Stosufy/tmp/media'
			};
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
						entries: [{ title: 'a' }, { title: 'b' }, { title: 'c' }]
					},
					[SLOW]: {
						_type: 'video',
						title: 'Slow one',
						duration: 100,
						extractor_key: 'Soundcloud',
						webpage_url: SLOW,
						formats: [{ vcodec: 'none' }]
					}
				},
				errors: { [PRIVATE]: 'This video is private' }
			};
		},
		{
			YOUTUBE,
			TWITCH,
			PLAYLIST,
			PRIVATE,
			SLOW,
			yt: [...formats([360, 720, 1080]), { vcodec: 'none' }],
			tw: formats([160, 480, 720, 1080])
		}
	);
	const requests = () => page.evaluate(() => window.__ytdlp.requests ?? []);
	const link = async (url) => {
		await page.fill('input[aria-label="Link"]', url);
		await page.press('input[aria-label="Link"]', 'Enter');
	};
	const row = (title) => page.locator(`ul[aria-label="Downloads"] > li[aria-label="${title}"]`);

	await page.click('header button[aria-label="Downloader"]');
	await page.waitForURL('**/addons/download');
	await page.waitForSelector('text=Paste a link to start');
	check('its page: a field for the link', true);

	// --- A YouTube video's sound -------------------------------------------------------------
	await link(YOUTUBE);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Test song")');
	check(
		'what it is: its site, channel and length',
		/youtube/i.test(await page.locator('section[aria-label="What it is"]').innerText()) &&
			/Someone · 3:35/.test(await page.locator('section[aria-label="What it is"]').innerText())
	);
	check(
		'YouTube support fetched for a YouTube link',
		(await page.evaluate(() => window.__ytdlp.denoInstalls)) === 1
	);
	const qualities = await page
		.locator('[role="radiogroup"][aria-label="Quality"] button')
		.allInnerTexts();
	check(
		'its qualities, the best first',
		JSON.stringify(qualities) === JSON.stringify(['Best', '1080p', '720p', '360p']),
		JSON.stringify(qualities)
	);
	await page.click('[role="radiogroup"][aria-label="What"] button:has-text("Only the sound")');
	await page.click('[role="radiogroup"][aria-label="Sound format"] button:has-text("MP3")');
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Test song').locator('text=Test song.mp3').waitFor();
	const first = (await requests())[0];
	check(
		'asked for: its sound as MP3, sponsors out, just the video',
		first.kind === 'audio' &&
			first.format === 'mp3' &&
			first.sponsorblock === true &&
			first.playlist === false &&
			first.sections.length === 0 &&
			first.cookies === null,
		JSON.stringify(first)
	);
	check(
		'saved in Stosufy/Downloads',
		await page.evaluate(() => !!window.__written['/home/tester/Stosufy/Downloads/Test song.mp3'])
	);
	check(
		'the field empty again, for the next link',
		(await page.inputValue('input[aria-label="Link"]')) === ''
	);

	// --- A part of a Twitch VOD --------------------------------------------------------------
	await link(TWITCH);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Long stream")');
	check(
		'Twitch: no YouTube support needed',
		(await page.evaluate(() => window.__ytdlp.denoInstalls)) === 1
	);
	check(
		'the last choice kept (only the sound)',
		(await page.getAttribute(
			'[role="radiogroup"][aria-label="What"] button:has-text("Only the sound")',
			'aria-checked'
		)) === 'true'
	);
	await page.click('[role="radiogroup"][aria-label="What"] button:has-text("Video")');
	await page.click('[role="radiogroup"][aria-label="Video format"] button:has-text("MP4")');
	await page.click('[role="radiogroup"][aria-label="Quality"] button:has-text("720p")');
	await page.check('text=Only a part of it');
	await page.fill('input[aria-label="Part start time"]', '1:00:00');
	await page.press('input[aria-label="Part start time"]', 'Enter');
	await page.fill('input[aria-label="Part end time"]', '1:05:00');
	await page.press('input[aria-label="Part end time"]', 'Enter');
	check('the part shown: 5 minutes', (await page.locator('text=5:00 of 3:02:00').count()) === 1);
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Long stream').locator('text=Long stream.mp4').waitFor();
	const second = (await requests())[1];
	check(
		'asked for: 1:00:00–1:05:00, cut exactly, as a 720p MP4',
		JSON.stringify(second.sections) === '[[3600,3900]]' &&
			second.exactCuts === true &&
			second.kind === 'video' &&
			second.format === 'mp4' &&
			second.height === 720 &&
			second.sponsorblock === false,
		JSON.stringify(second)
	);
	check(
		'the download says what it is',
		/Twitch · MP4 · 720p · 1:00:00–1:05:00/.test(await row('Long stream').innerText()),
		await row('Long stream').innerText()
	);

	// --- A playlist, a private video ---------------------------------------------------------
	await link(PLAYLIST);
	await page.waitForSelector('text=All 3 videos of the playlist');
	check('a playlist: all of its videos, to choose', true);
	await link(PRIVATE);
	await page.waitForSelector('text=This video is private');
	check("a link that can't be: says why", true);

	// --- Signed in, stopped ------------------------------------------------------------------
	await page.selectOption('select[aria-label="Signed in as"]', 'firefox');
	await link(SLOW);
	await page.waitForSelector('section[aria-label="What it is"] h2:has-text("Slow one")');
	check(
		'only sound there: no video to choose',
		(await page.locator('[role="radiogroup"][aria-label="What"]').count()) === 0
	);
	await page.click('section[aria-label="What it is"] button:has-text("Download")');
	await row('Slow one').waitFor();
	check('signed in as in Firefox', (await requests())[2].cookies === 'firefox');
	await page.click('button[aria-label="Stop Slow one"]');
	await row('Slow one').waitFor({ state: 'detached' });
	check('stopped: off the list', true);

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

	await browser.close();
	console.log(`\n${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
