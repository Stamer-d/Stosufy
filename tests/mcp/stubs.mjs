// Stand-ins for Tauri's plugins and what else only the app has. Requests go to
// globalThis.fakeFetch (the test's osu! and Stamer API), saved files stay in memory.
export const goto = async (path) => (globalThis.wentTo = path);
export const fetch = (url, init) => globalThis.fakeFetch(String(url), init);

const files = new Map();
export async function load(name) {
	if (!files.has(name)) files.set(name, new Map());
	const data = files.get(name);
	return {
		get: async (key) => data.get(key),
		set: async (key, value) => void data.set(key, value),
		save: async () => {},
		clear: async () => data.clear()
	};
}

const missing = async () => {
	throw new Error('No files in the tests');
};
export const BaseDirectory = { Home: 0, AppData: 1 };
export const exists = async () => false;
export const mkdir = async () => {};
export const readTextFile = missing;
export const writeTextFile = async () => {};
export const readFile = missing;
export const writeFile = async () => {};
export const readDir = async () => [];
export const remove = async () => {};
export const rename = async () => {};
export const open = async () => null;
export const homeDir = async () => '/home/test';
export const join = async (...parts) => parts.join('/');
export const convertFileSrc = (file) => file;
export class FFmpeg {}
export const setActivity = async () => {};
export const start = async () => {};
/** Discord's activity: every setter gives it back, for chaining */
export class Activity {
	constructor() {
		const chained = new Proxy(this, {
			get: (target, key) => (key in target ? target[key] : () => chained)
		});
		return chained;
	}
}
export const ActivityType = {};
export default '';
