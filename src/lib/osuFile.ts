// Parsing of the .osu files inside a beatmap set (.osz)

function eventsSection(osuFileContent: string) {
	return osuFileContent.split(/^\[Events\]\s*$/m)[1]?.split(/^\[/m)[0];
}

/** The video of a beatmap and its start in ms: the `Video,offset,"file"` line in [Events] */
export function findVideo(osuFileContent: string): { file: string; offset: number } | null {
	const events = eventsSection(osuFileContent);
	const match = events?.match(/^(?:Video|1)\s*,\s*(-?\d+)\s*,\s*"?([^",\r\n]+)"?/m);
	return match ? { file: match[2].trim().replace(/\\/g, '/'), offset: Number(match[1]) } : null;
}

/** The background image of a beatmap: the `0,0,"file"` line in the [Events] section */
export function findBackground(osuFileContent: string): string | null {
	const events = eventsSection(osuFileContent);
	const match = events?.match(/^0\s*,\s*0\s*,\s*"?([^",\r\n]+)"?/m);
	return match ? match[1].trim().replace(/\\/g, '/') : null;
}
