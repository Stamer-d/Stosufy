/// <reference types="node" />
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

/**
 * The web app (`vite build --mode web`, see src/web): what a browser can't run is swapped for
 * the web's own (fetch, IndexedDB, a pasted login, no library of downloads); the rest of
 * src/lib (playlists, the API, …) is the app's very own
 */
const WEB_PACKAGES = {
	'@tauri-apps/plugin-http': 'src/web/shims/http.ts',
	'@tauri-apps/plugin-store': 'src/web/shims/store.ts'
};
const WEB_FILES = {
	'src/lib/stores/auth.ts': 'src/web/shims/auth.ts',
	'src/lib/stores/data.ts': 'src/web/shims/data.ts',
	'src/lib/stores/audio.ts': 'src/web/shims/audio.ts'
};
function webModules() {
	return {
		name: 'stosufy-web-modules',
		enforce: 'pre',
		async resolveId(source, importer, options) {
			if (WEB_PACKAGES[source]) return path.resolve(WEB_PACKAGES[source]);
			if (!importer || !/^(\.|#lib|\$lib)/.test(source)) return null;
			const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
			const file = resolved?.id.split('?')[0].replaceAll('\\', '/');
			const swap = file && Object.keys(WEB_FILES).find((from) => file.endsWith(from));
			return swap ? path.resolve(WEB_FILES[swap]) : null;
		}
	};
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	// (also through the environment: SvelteKit reads this config again in a process of its own
	// after the build, without the mode)
	if (mode === 'web') process.env.STOSUFY_WEB = '1';
	const web = process.env.STOSUFY_WEB === '1';
	return {
		// (the web app's path on its server, e.g. /Stosufy on GitHub Pages)
		define: web
			? {
					__WEB_BASE__: JSON.stringify(process.env.WEB_BASE ?? ''),
					// (which build is on the phone: the commit, or when it was built)
					__WEB_VERSION__: JSON.stringify(
						process.env.GITHUB_SHA?.slice(0, 7) ?? new Date().toISOString().slice(0, 16)
					)
				}
			: {},
		plugins: [
			web && webModules(),
			sveltekit({
				preprocess: vitePreprocess(),
				adapter: adapter(
					web
						? // (GitHub Pages answers every other path with 404.html: the app opens there)
							{ pages: 'build-web', assets: 'build-web', fallback: '404.html' }
						: { fallback: 'index.html' }
				),
				...(web && {
					outDir: '.svelte-kit-web',
					files: {
						routes: 'src/web/routes',
						appTemplate: 'src/web/app.html',
						serviceWorker: 'src/web/service-worker',
						assets: 'src/web/static'
					},
					paths: { base: /** @type {'' | `/${string}`} */ (process.env.WEB_BASE ?? '') }
				})
			}),
			tailwindcss()
		],
		optimizeDeps: {
			exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		},
		build: {
			// three.js (the puzzle's 3D view) is one chunk of ~600 kB, loaded only when it opens
			chunkSizeWarningLimit: 700
		},
		worker: {
			format: 'es',
			plugins: () => [],
			rollupOptions: {
				output: {
					format: 'es'
				}
			}
		},
		// Vite options tailored for Tauri development
		clearScreen: false,
		server: {
			port: 2021,
			strictPort: true,
			host: host || false,
			hmr: host
				? {
						protocol: 'ws',
						host,
						port: 2021
					}
				: undefined,
			watch: {
				ignored: ['**/src-tauri/**']
			}
		}
	};
});
