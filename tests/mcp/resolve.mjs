// Lets Node run the app's tools for Claude as they are: what only Tauri, Vite or the
// browser have is swapped for the stand-ins in stubs.mjs (and the `.ts` Vite leaves out of
// the imports is added)
const STUBBED = new Set([
	'$app/navigation',
	'@tauri-apps/plugin-http',
	'@tauri-apps/plugin-store',
	'@tauri-apps/plugin-fs',
	'@tauri-apps/plugin-dialog',
	'@tauri-apps/api/path',
	'@tauri-apps/api/core',
	'@ffmpeg/ffmpeg',
	'tauri-plugin-drpc',
	'tauri-plugin-drpc/activity'
]);
const stubs = new URL('./stubs.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
	// (Vite's ?raw imports, a file's text: none here)
	if (STUBBED.has(specifier) || specifier.endsWith('?raw')) {
		return { url: `${stubs}?${encodeURIComponent(specifier)}`, shortCircuit: true };
	}
	if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
		try {
			return await next(`${specifier}.ts`, context);
		} catch {
			// Not a .ts file: as it was
		}
	}
	return next(specifier, context);
}

export async function load(url, context, next) {
	const result = await next(url, context);
	// Vite's import.meta.env (the osu! client secret) and import.meta.glob (bundled files): not here
	if (url.includes('/src/') && result.source) {
		const source = String(result.source)
			.replaceAll('import.meta.env', '({})')
			.replaceAll('import.meta.glob', '(() => ({}))');
		return { ...result, source };
	}
	return result;
}
