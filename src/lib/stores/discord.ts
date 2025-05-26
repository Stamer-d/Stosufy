import { destroy, start } from 'tauri-plugin-drpc';
import { setActivity } from 'tauri-plugin-drpc';
import { Activity, ActivityType } from 'tauri-plugin-drpc/activity';

const defaultActivity = new Activity()
	.setDetails('Idle')
	.setState('Browsing songs 🎧')
	.setActivity(ActivityType.Listening);

export async function startDiscord() {
	await start('1364962218805952532');
	await setActivity(defaultActivity);
	console.log('Discord RPC started');
}

export async function setRPCActivity(songData) {
	if (!songData) {
		console.log('No song data provided, clearing activity.');
		await setActivity(defaultActivity);
		return;
	}

	const activity = new Activity()
		.setDetails(songData?.title)
		.setState(songData?.artist)
		.setActivity(ActivityType.Listening);
	await setActivity(activity);
}

export async function stopDiscord() {
	await destroy();
}
