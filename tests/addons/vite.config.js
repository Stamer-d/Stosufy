// The desktop app for a browser, to test it without Tauri: its http and its stores are the
// web app's (fetch and IndexedDB), everything else is the desktop app as it is. Tauri's own
// calls (the window, files, shortcuts) get a mock from harness.cjs.
import path from 'node:path';
import base from '../../vite.config.js';

const SHIMS = {
	'@tauri-apps/plugin-http': 'src/web/shims/http.ts',
	'@tauri-apps/plugin-store': 'src/web/shims/store.ts'
};

export default (env) => {
	const config = base(env);
	config.plugins.unshift({
		name: 'stosufy-desktop-in-a-browser',
		enforce: 'pre',
		resolveId: (source) => (SHIMS[source] ? path.resolve(SHIMS[source]) : null)
	});
	config.server = { ...config.server, port: 5289, strictPort: true, host: '127.0.0.1' };
	return config;
};
