import { setActivity, start } from 'tauri-plugin-drpc';
import { Activity, ActivityType } from 'tauri-plugin-drpc/activity';
import type { MapSet } from '../types';

const defaultActivity = new Activity()
	.setDetails('Idle')
	.setState('Browsing songs 🎧')
	.setActivity(ActivityType.Listening);

export async function startDiscord() {
	await start('1364962218805952532');
	await setActivity(defaultActivity);
	console.log('Discord RPC started');
}

export async function setRPCActivity(songData: MapSet | null) {
	if (!songData) {
		await setActivity(defaultActivity);
		return;
	}

	const activity = new Activity()
		.setDetails(songData?.title)
		.setState(songData?.artist)
		.setActivity(ActivityType.Listening);
	await setActivity(activity);
}
