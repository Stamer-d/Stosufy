// The osu! (stable) folder: chosen once in the settings, or found where osu! usually is. Its
// songs and skins come from it: the Songs folder (or wherever osu!.<user>.cfg's
// BeatmapDirectory says) and the Skins folder. No need to point at each of them.

import { get } from 'svelte/store';
import * as path from '@tauri-apps/api/path';
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { userSettings, updateUserSettings } from './user';
import { showToast } from './toast';

const found = async (folder: string) => exists(folder).catch(() => false);

/** Where osu! usually is: Windows' own, or on macOS and Linux one running in Wine */
async function candidates(): Promise<string[][]> {
	const list: string[][] = [];
	try {
		list.push([await path.localDataDir(), 'osu!']);
	} catch {
		// no local data folder
	}
	try {
		const home = await path.homeDir();
		const user = home.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
		const wine = (prefix: string[]) => [
			[...prefix, 'drive_c', 'osu!'],
			[...prefix, 'drive_c', 'users', user, 'AppData', 'Local', 'osu!'],
			[...prefix, 'drive_c', 'users', 'crossover', 'AppData', 'Local', 'osu!'],
			[...prefix, 'drive_c', 'Program Files', 'osu!']
		];
		list.push(
			// osu-winello and the osu-wine scripts
			[home, '.local', 'share', 'osu-wine', 'osu!'],
			[home, '.local', 'share', 'osu-wine', 'OSU'],
			[home, '.local', 'share', 'osu-wine', 'osu-stable'],
			[home, '.local', 'share', 'osu-stable'],
			[home, 'osu!'],
			[home, 'Games', 'osu!'],
			...wine([home, '.wine']),
			...wine([home, 'Games', 'osu', 'prefix']),
			...wine([home, '.local', 'share', 'bottles', 'bottles', 'osu']),
			...wine([home, 'Library', 'Application Support', 'osu-wine']),
			[home, 'Applications', 'osu!.app', 'Contents', 'Resources', 'drive_c', 'osu!'],
			[home, 'Applications', 'osu!.app', 'Contents', 'SharedSupport', 'prefix', 'drive_c', 'osu!']
		);
		// Whisky bottles have generated names: each one is looked into
		const bottles = await path.join(
			home,
			'Library',
			'Containers',
			'com.isaacmarovitz.Whisky',
			'Bottles'
		);
		if (await found(bottles))
			for (const bottle of await readDir(bottles).catch(() => []))
				if (bottle.isDirectory) list.push(...wine([bottles, bottle.name]));
	} catch {
		// no home folder
	}
	return list;
}

/** Whether a folder is an osu! installation (it has its Songs or Skins, or osu! itself) */
async function isOsuFolder(folder: string) {
	for (const inside of ['Songs', 'Skins', 'osu!.exe', 'osu!.db'])
		if (await found(await path.join(folder, inside))) return true;
	return false;
}

/** The osu! folder where osu! usually is, if there is one */
export async function detectOsuFolder(): Promise<string | null> {
	for (const parts of await candidates()) {
		try {
			const folder = await path.join(...parts);
			if (await isOsuFolder(folder)) return folder;
		} catch {
			// not this one
		}
	}
	return null;
}

/** The folder a path is in */
const parentOf = (folder: string) => folder.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
const nameOf = (folder: string) =>
	folder
		.replace(/[\\/]+$/, '')
		.split(/[\\/]/)
		.at(-1) ?? '';

/** The osu! folder: the one chosen, else the one osu! usually is in */
export async function osuFolder(): Promise<string | null> {
	const settings = get(userSettings).settings;
	if (settings?.osuFolder) return settings.osuFolder;
	// Chosen before there was one folder for everything: the Skins folder in it
	if (settings?.skinsFolder && /^skins$/i.test(nameOf(settings.skinsFolder)))
		return parentOf(settings.skinsFolder);
	return detectOsuFolder();
}

/**
 * The songs of an osu! folder: its Songs folder, or where its osu!.<user>.cfg says they are
 * (osu! lets them be moved: BeatmapDirectory, a path of its own or inside the osu! folder)
 */
export async function songsFolderOf(folder: string): Promise<string | null> {
	try {
		const configs = (await readDir(folder)).filter(
			(entry) => entry.isFile && /^osu!\..+\.cfg$/i.test(entry.name)
		);
		for (const config of configs) {
			const text = await readTextFile(await path.join(folder, config.name));
			const value = text.match(/^\s*BeatmapDirectory\s*=\s*(.+?)\s*$/m)?.[1];
			if (!value) continue;
			const songs = /^([a-z]:[\\/]|[\\/])/i.test(value) ? value : await path.join(folder, value);
			if (await found(songs)) return songs;
		}
	} catch {
		// no config to read: the usual place
	}
	const songs = await path.join(folder, 'Songs');
	return (await found(songs)) ? songs : null;
}

/** The osu! Songs folder */
export async function osuSongsFolder() {
	const folder = await osuFolder();
	return folder ? songsFolderOf(folder) : null;
}

/** The osu! Skins folder */
export async function osuSkinsFolder(): Promise<string | null> {
	const settings = get(userSettings).settings;
	// A Skins folder chosen on its own (before), somewhere else than in an osu! folder
	if (
		!settings?.osuFolder &&
		settings?.skinsFolder &&
		!/^skins$/i.test(nameOf(settings.skinsFolder))
	)
		return settings.skinsFolder;
	const folder = await osuFolder();
	if (!folder) return null;
	const skins = await path.join(folder, 'Skins');
	return (await found(skins)) ? skins : null;
}

/** Lets the user pick their osu! folder (the one with osu!.exe); null if they didn't */
export async function pickOsuFolder(): Promise<string | null> {
	const picked = await open({
		title: 'Select your osu! folder (the one with osu!.exe)',
		directory: true,
		// Access to its songs and skins too, not just the folder itself
		recursive: true,
		defaultPath: (await osuFolder()) ?? undefined
	});
	if (typeof picked !== 'string') return null;
	if (/^(songs|skins)$/i.test(nameOf(picked))) {
		showToast(
			`That's osu!'s ${nameOf(picked)} folder: pick the osu! folder itself, the one it's in`,
			'icon-[mingcute--folder-open-line]'
		);
		return null;
	}
	if (!(await isOsuFolder(picked))) {
		showToast(
			"There's no osu! in that folder (no Songs, no Skins, no osu!.exe)",
			'icon-[mingcute--warning-line]'
		);
		return null;
	}
	updateUserSettings({ osuFolder: picked, skinsFolder: null });
	return picked;
}
