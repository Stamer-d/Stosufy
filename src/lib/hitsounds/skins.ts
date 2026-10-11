// Skins for the hitsounds: the osu! default sounds (downloaded once from ppy/osu-resources),
// skins imported from .osk files (only their hitsounds are kept, in Stosufy's own folder)
// and the skins of an osu! installation.

import { get, writable } from 'svelte/store';
import JSZip from 'jszip';
import { readDir, readFile, writeFile, mkdir, exists, remove } from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';
import { fetch } from '@tauri-apps/plugin-http';
import { open } from '@tauri-apps/plugin-dialog';
import { userSettings } from '../stores/user';

/** The setting for the simple built-in sounds */
export const BUILTIN = 'builtin';
/** The osu! default sounds, saved as a skin under this name */
export const DEFAULT_SKIN = 'osu! default';
/** The samples a skin needs for the hitsounds */
/** The samples a skin's hitsounds use (osu! doesn't use numbered ones from skins) */
const HITSOUND_FILE =
	/^((normal|soft|drum)-)?(hit(normal|whistle|finish|clap)|slider(slide|tick|whistle))\.(wav|ogg|mp3)$/i;

export interface SkinOption {
	/** "stosufy:<name>" or "osu:<name>" */
	id: string;
	name: string;
	source: 'stosufy' | 'osu';
}

export const skinsChanged = writable(0);
export const skinTask = writable<{ state: 'idle' | 'working' | 'error'; message?: string }>({
	state: 'idle'
});

export async function stosufySkinsDir() {
	return path.join(await path.homeDir(), 'Stosufy', 'Skins');
}

/** The osu! Skins folder: chosen in the settings, else the default osu! one */
export async function osuSkinsDir(): Promise<string | null> {
	const chosen = get(userSettings).settings?.skinsFolder;
	if (chosen) return chosen;
	try {
		const dir = await path.join(await path.localDataDir(), 'osu!', 'Skins');
		return (await exists(dir)) ? dir : null;
	} catch {
		return null;
	}
}

async function folders(dir: string | null) {
	if (!dir) return [];
	try {
		return (await readDir(dir))
			.filter((entry) => entry.isDirectory)
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

/** All skins to choose from: Stosufy's own first, then the osu! ones */
export async function listSkins(): Promise<SkinOption[]> {
	const [own, osu] = await Promise.all([
		folders(await stosufySkinsDir()),
		folders(await osuSkinsDir())
	]);
	return [
		...own.map((name) => ({ id: `stosufy:${name}`, name, source: 'stosufy' as const })),
		...osu.map((name) => ({ id: `osu:${name}`, name, source: 'osu' as const }))
	];
}

/**
 * The folder of a skin setting; null (the default) is the osu! default sounds, if they are
 * downloaded. Plain names are skins in the osu! folder (how they were saved before).
 */
export async function skinFolder(setting: string | null | undefined): Promise<string | null> {
	if (setting === BUILTIN) return null;
	if (!setting) {
		const dir = await path.join(await stosufySkinsDir(), DEFAULT_SKIN);
		return (await exists(dir).catch(() => false)) ? dir : null;
	}
	if (setting.startsWith('stosufy:')) return path.join(await stosufySkinsDir(), setting.slice(8));
	const osu = await osuSkinsDir();
	return osu ? path.join(osu, setting.replace(/^osu:/, '')) : null;
}

export async function hasDefaultSkin() {
	return exists(await path.join(await stosufySkinsDir(), DEFAULT_SKIN)).catch(() => false);
}

let downloading: Promise<boolean> | null = null;

/** Downloads the osu! default hitsounds once; true when they're there */
export function downloadDefaultSkin(): Promise<boolean> {
	downloading ??= (async () => {
		if (await hasDefaultSkin()) return true;
		skinTask.set({ state: 'working', message: 'Downloading the osu! default sounds…' });
		try {
			// The repository's files, to find the folder with the default hitsounds: the
			// classic (Legacy) ones if there, else the folder with the most of them
			const response = await fetch(
				'https://api.github.com/repos/ppy/osu-resources/git/trees/HEAD?recursive=1',
				{ headers: { Accept: 'application/vnd.github+json' } }
			);
			if (!response.ok) throw new Error(`GitHub answered with HTTP ${response.status}`);
			const { tree } = (await response.json()) as { tree: { path: string; type: string }[] };
			const byFolder = new Map<string, string[]>();
			for (const entry of tree) {
				const name = entry.path.split('/').pop()!;
				if (entry.type !== 'blob' || !HITSOUND_FILE.test(name)) continue;
				const folder = entry.path.slice(0, -name.length - 1);
				byFolder.set(folder, [...(byFolder.get(folder) ?? []), entry.path]);
			}
			const candidates = [...byFolder.entries()]
				.filter(([folder, files]) => files.length >= 4 && !/argon/i.test(folder))
				.sort(
					([a, filesA], [b, filesB]) =>
						Number(/legacy/i.test(b)) - Number(/legacy/i.test(a)) || filesB.length - filesA.length
				);
			const files = candidates[0]?.[1];
			if (files) {
				const dir = await path.join(await stosufySkinsDir(), DEFAULT_SKIN);
				const temp = dir + '.part';
				await mkdir(temp, { recursive: true });
				for (const file of files) {
					const data = await fetch(
						`https://raw.githubusercontent.com/ppy/osu-resources/HEAD/${file.split('/').map(encodeURIComponent).join('/')}`
					);
					if (!data.ok) throw new Error(`GitHub answered with HTTP ${data.status}`);
					await writeFile(
						await path.join(temp, file.split('/').pop()!),
						new Uint8Array(await data.arrayBuffer())
					);
				}
				await rename(temp, dir);
				skinTask.set({ state: 'idle' });
				skinsChanged.update((n) => n + 1);
				return true;
			}
			throw new Error("Couldn't find the osu! default sounds");
		} catch (error) {
			console.error('Could not download the osu! default sounds:', error);
			skinTask.set({
				state: 'error',
				message: "Couldn't download the osu! default sounds. The simple built-in ones play."
			});
			return false;
		} finally {
			downloading = null;
		}
	})();
	return downloading;
}

async function rename(from: string, to: string) {
	// plugin-fs has no folder rename across all platforms here: copy the files over
	await mkdir(to, { recursive: true });
	for (const entry of await readDir(from)) {
		if (!entry.isFile) continue;
		await writeFile(
			await path.join(to, entry.name),
			await readFile(await path.join(from, entry.name))
		);
	}
	await remove(from, { recursive: true }).catch(() => {});
}

/** Depth of a folder in an archive ("" is the top) */
const depth = (folder: string) => (folder ? folder.split('/').length : 0);
const folderOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/**
 * The hitsound files of a skin archive that osu! would use: the ones right in the skin's
 * folder (where skin.ini is, else the topmost folder with hitsounds). Skins often keep
 * spare versions in subfolders (e.g. "hitsound/"), which must not replace the real ones.
 */
export function skinHitsoundFiles(names: string[]): { root: string; files: string[] } | null {
	const ini = names
		.filter((name) => /(^|\/)skin\.ini$/i.test(name))
		.sort((a, b) => depth(folderOf(a)) - depth(folderOf(b)))[0];
	const hitsounds = names.filter((name) => HITSOUND_FILE.test(name.split('/').pop() ?? ''));
	const root =
		ini !== undefined
			? folderOf(ini)
			: hitsounds.map(folderOf).sort((a, b) => depth(a) - depth(b))[0];
	const files = hitsounds.filter((name) => folderOf(name) === root);
	return files.length ? { root: root ?? '', files } : null;
}

/** Imports the hitsounds of a skin file (.osk) the user picks; returns its option */
export async function importSkin(): Promise<SkinOption | null> {
	const picked = await open({
		title: 'Import a skin',
		filters: [{ name: 'osu! skin', extensions: ['osk', 'zip'] }]
	});
	if (typeof picked !== 'string') return null;
	skinTask.set({ state: 'working', message: 'Importing the skin…' });
	try {
		const zip = await JSZip.loadAsync(await readFile(picked));
		const entries = Object.values(zip.files).filter((file) => !file.dir);
		const found = skinHitsoundFiles(entries.map((file) => file.name));
		if (!found) {
			skinTask.set({ state: 'error', message: 'This skin has no hitsounds of its own.' });
			return null;
		}
		// The skin's name from its skin.ini, else the file's name
		const ini = entries.find(
			(file) => folderOf(file.name) === found.root && /(^|\/)skin\.ini$/i.test(file.name)
		);
		const iniName = ini && (await ini.async('string')).match(/^\s*Name\s*:\s*(.+?)\s*$/im)?.[1];
		const name = (iniName || (picked.split(/[\\/]/).pop() ?? 'Skin').replace(/\.(osk|zip)$/i, ''))
			.replace(/[\\/:*?"<>|]/g, '_')
			.trim();
		const dir = await path.join(await stosufySkinsDir(), name);
		// Importing again replaces the skin (also its samples from an earlier import)
		await remove(dir, { recursive: true }).catch(() => {});
		await mkdir(dir, { recursive: true });
		for (const file of found.files) {
			await writeFile(
				await path.join(dir, file.split('/').pop()!),
				await zip.files[file].async('uint8array')
			);
		}
		skinTask.set({ state: 'idle' });
		skinsChanged.update((n) => n + 1);
		return { id: `stosufy:${name}`, name, source: 'stosufy' };
	} catch (error) {
		console.error('Could not import the skin:', error);
		skinTask.set({ state: 'error', message: "Couldn't read that file as an osu! skin." });
		return null;
	}
}

/** Removes a skin imported into Stosufy */
export async function removeSkin(id: string) {
	if (!id.startsWith('stosufy:')) return;
	await remove(await path.join(await stosufySkinsDir(), id.slice(8)), { recursive: true });
	skinsChanged.update((n) => n + 1);
}
