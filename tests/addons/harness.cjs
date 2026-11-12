// The desktop app in a browser: Tauri's calls mocked, the device's saved data put there
// before the app starts, no network (or a mock of the Stosufy API, for the settings sync)
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5289';
const API = 'https://api.stamer-d.de/v2/';
const USER = { id: 1, username: 'tester', avatar_url: null };

/** Runs in the page before the app: what the app asks Tauri for */
function tauri({ online, writes }) {
	let next = 1;
	// (with `writes`: the files written, by path, to look at and to read again)
	const written = (window.__written = {});
	const pathOf = (options) => decodeURIComponent(options?.headers?.path ?? '');
	window.__TAURI_INTERNALS__ = {
		metadata: {
			currentWindow: { label: 'main' },
			currentWebview: { label: 'main', windowLabel: 'main' }
		},
		transformCallback: () => next++,
		unregisterCallback() {},
		convertFileSrc: (path) => 'asset://' + path,
		async invoke(cmd, args, options) {
			if (cmd === 'plugin:event|listen') return next++;
			if (writes && cmd === 'plugin:path|join') return args.paths.join('/');
			if (writes && cmd === 'plugin:path|basename') return args.path.split('/').pop();
			if (cmd.startsWith('plugin:path|')) return '/home/tester';
			if (writes && cmd === 'plugin:fs|write_file') {
				written[pathOf(options)] = new Uint8Array(args);
				return null;
			}
			if (writes && cmd === 'plugin:fs|read_file' && written[args.path]) return written[args.path];
			if (cmd === 'plugin:fs|exists') return !!(writes && written[args.path]);
			if (cmd === 'plugin:opener|reveal_item_in_dir') return (window.__revealed = args.paths);
			if (cmd === 'copy_files') return void (window.__copied = args.paths);
			if (cmd === 'clipboard_link') return window.__clipboardLink ?? null;
			// (the cookies file: what a test put in window.__cookiesToAdd is chosen)
			if (cmd === 'cookies_info') return window.__cookies ?? null;
			if (cmd === 'cookies_add') return (window.__cookies = window.__cookiesToAdd ?? null);
			if (cmd === 'cookies_remove') return void (window.__cookies = null);
			if (writes && cmd === 'files_replace') {
				written[args.to] = written[args.from];
				delete written[args.from];
				return void (window.__replaced = args);
			}
			if (cmd === 'plugin:drag|start_drag') return void (window.__dragged = args.item);
			// (the system's file picker: what a test put in window.__pickable, read from there)
			if (cmd === 'files_pick') return window.__pickable ?? null;
			// (the computer's FFmpeg and yt-dlp: what a test put in window.__ffmpegStatus and
			// window.__ytdlp)
			if (cmd === 'ffmpeg_status') return window.__ffmpegStatus ?? null;
			const yt = window.__ytdlp;
			if (yt && cmd === 'ytdlp_status') return yt.status;
			if (yt && cmd === 'ytdlp_install') return 'current';
			if (yt && cmd === 'deno_install') return void (yt.denoInstalls = (yt.denoInstalls ?? 0) + 1);
			if (yt && cmd === 'ytdlp_info') {
				(yt.looked ??= []).push({ url: args.url, cookies: args.cookies });
				if (yt.locked?.includes(args.cookies))
					throw "Your browser's sign-in couldn't be read: close the browser and try again, or choose Firefox";
				// (an error, unless signed in as that error's browser wants)
				if (yt.errors?.[args.url] && yt.unlocks?.[args.url] !== args.cookies)
					throw yt.errors[args.url];
				return JSON.stringify(yt.infos[args.url]);
			}
			if (yt && cmd === 'ytdlp_cancel') return void yt.cancel?.(args.id);
			if (yt && cmd === 'ytdlp_download') {
				(yt.requests ??= []).push(args.request);
				if (yt.locked?.includes(args.request.cookies))
					throw "Your browser's sign-in couldn't be read: close the browser and try again, or choose Firefox";
				if (args.request.url === yt.slow)
					return new Promise(
						(resolve) => (yt.cancel = () => resolve({ files: [], cancelled: true }))
					);
				const info = yt.infos[args.request.url];
				const ext = args.request.kind === 'audio' ? args.request.format : args.request.format;
				const path = `/home/tester/Stosufy/tmp/downloads/${args.id}/${info.title}.${ext}`;
				written[path] = new Uint8Array(yt.file ?? [1, 2, 3]);
				return {
					files: [{ path, size: written[path].length }],
					cancelled: false,
					error: yt.notes?.[args.request.url] ?? null
				};
			}
			if (writes && cmd === 'plugin:fs|rename') {
				written[args.newPath] = written[args.oldPath];
				delete written[args.oldPath];
				return null;
			}
			if (writes && cmd === 'plugin:fs|remove') return null;
			if (cmd === 'files_read') {
				(window.__read ??= []).push(args.path);
				return new Uint8Array(window.__pickBytes[args.path]);
			}
			if (cmd === 'plugin:fs|read_dir') return [];
			if (cmd === 'plugin:fs|mkdir') return null;
			if (cmd.startsWith('plugin:fs|')) throw new Error('no file (mock)');
			return null;
		}
	};
	window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
	if (!online) Object.defineProperty(navigator, 'onLine', { get: () => false });
}

/**
 * The app, started. `stored`: the user data saved on the device ({ settings }), none for a
 * new user. `account`: the settings saved in the account ({ settings, updatedAt }, or null for
 * none yet), with which the app starts online and syncs; without it the app starts offline.
 * Returns the page, its errors, and what was saved to the account since (`sent`). `scale`: 2
 * for sharp pictures of it. `writes`: files written are kept (window.__written), not refused.
 * `allow`: the URLs that go out to the network (FFmpeg's core, say).
 */
async function start(browser, { stored = null, account, scale = 1, writes = false, allow } = {}) {
	const online = account !== undefined;
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: scale,
		permissions: ['clipboard-read', 'clipboard-write']
	});
	await context.addInitScript(tauri, { online, writes });
	const sent = [];
	let remote = account ?? null;
	await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
		const request = route.request();
		if (allow?.test(request.url())) return route.continue();
		if (!online || request.url() !== API) return route.abort();
		const { query = '', variables = {} } = JSON.parse(request.postData() ?? '{}');
		let data = null;
		if (query.includes('getStosufyUser {'))
			data = { getStosufyUser: { stosufyId: 1, osuProfile: USER } };
		else if (query.includes('getStosufySettings')) data = { getStosufySettings: remote };
		else if (query.includes('saveStosufySettings')) {
			remote = { settings: variables.settings, updatedAt: (remote?.updatedAt ?? 0) + 1 };
			sent.push(variables.settings);
			data = { saveStosufySettings: remote.updatedAt };
		}
		await route.fulfill({
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body: JSON.stringify(data ? { data } : { errors: [{ message: 'Not in the mock' }] })
		});
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error.stack || error)));
	// (a page of the same origin first: the saved data has to be there before the app starts)
	await page.goto(BASE + '/logo.png');
	await page.evaluate(
		async ({ stored, user }) => {
			localStorage.setItem('stosufy-last-user', JSON.stringify(user));
			const db = await new Promise((resolve, reject) => {
				const request = indexedDB.open('stosufy', 1);
				request.onupgradeneeded = () => request.result.createObjectStore('stores');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const tx = db.transaction('stores', 'readwrite');
			const keys = { access_token: 'token', refresh_token: 'refresh', sessionKey: '' };
			tx.objectStore('stores').put(
				{ ...keys, expiry_time: Date.now() + 1e9 },
				'keyStore.json/store'
			);
			if (stored) tx.objectStore('stores').put(stored, 'userData.json/user');
			await new Promise((resolve) => (tx.oncomplete = resolve));
			db.close();
		},
		{ stored, user: USER }
	);
	await page.goto(BASE + '/');
	await page.waitForURL('**/home', { timeout: 60000 });
	await page.waitForSelector('button[aria-label="Add-ons"]', { timeout: 60000 });
	return { page, context, errors, sent };
}

/** The settings saved on the device (the app saves a moment after a change) */
async function saved(page) {
	await page.waitForTimeout(1300);
	return page.evaluate(async () => {
		const db = await new Promise((resolve) => {
			const request = indexedDB.open('stosufy', 1);
			request.onsuccess = () => resolve(request.result);
		});
		return new Promise((resolve) => {
			const request = db.transaction('stores').objectStore('stores').get('userData.json/user');
			request.onsuccess = () => {
				db.close();
				resolve(request.result?.settings);
			};
		});
	});
}

module.exports = { chromium, start, saved };
