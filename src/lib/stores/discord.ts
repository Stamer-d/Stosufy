import { setActivity, start } from 'tauri-plugin-drpc';
import { Activity, ActivityType } from 'tauri-plugin-drpc/activity';
import { isMobile } from '../platform';
import type { MapSet } from '../types';

const defaultActivity = new Activity()
	.setDetails('Idle')
	.setState('Browsing songs 🎧')
	.setActivity(ActivityType.Listening);

/** Discord isn't running (or not installed): the status is left alone, quietly */
let started = false;

export async function startDiscord() {
	// (no Discord on a phone)
	if (isMobile) return;
	try {
		await start('1364962218805952532');
		started = true;
		console.log('Discord RPC started');
	} catch (error) {
		console.warn('Discord RPC is not available:', error);
		return;
	}
	await setRPCActivity(null);
}

export async function setRPCActivity(songData: MapSet | null) {
	if (!started) return;
	const activity = songData
		? new Activity()
				.setDetails(songData.title)
				.setState(songData.artist)
				.setActivity(ActivityType.Listening)
		: defaultActivity;
	try {
		await setActivity(activity);
	} catch (error) {
		console.warn('Could not update the Discord status:', error);
	}
}
