// FFmpeg's arguments for each format: sound (with its tags and cover where the format holds
// one), video, and pictures the browser can't write. A bitrate given (for a size limit) takes
// the place of the quality's.

export type Quality = 'small' | 'balanced' | 'best';

/** Formats that hold a cover picture (Ogg and Opus don't, in FFmpeg) */
const WITH_COVER = new Set(['mp3', 'm4a', 'flac']);
/** Formats whose size the bitrate sets (WAV, FLAC and AIFF are as big as they are) */
export const LOSSY_AUDIO = new Set(['mp3', 'ogg', 'opus', 'm4a']);

const AUDIO_KBPS: Record<string, Record<Quality, number>> = {
	mp3: { small: 128, balanced: 192, best: 320 },
	ogg: { small: 112, balanced: 160, best: 256 },
	opus: { small: 64, balanced: 128, best: 192 },
	m4a: { small: 128, balanced: 192, best: 256 }
};

export function audioKbps(target: string, quality: Quality) {
	return AUDIO_KBPS[target]?.[quality] ?? 192;
}

function audioCodec(target: string, quality: Quality, kbps?: number) {
	const rate = (fallback: number) => ['-b:a', `${Math.round(kbps ?? fallback)}k`];
	switch (target) {
		case 'mp3':
			return ['-c:a', 'libmp3lame', ...rate(audioKbps(target, quality))];
		case 'ogg':
			return kbps
				? ['-c:a', 'libvorbis', ...rate(kbps)]
				: ['-c:a', 'libvorbis', '-q:a', { small: '3', balanced: '5', best: '8' }[quality]];
		case 'opus':
			return ['-c:a', 'libopus', ...rate(audioKbps(target, quality))];
		case 'm4a':
			return ['-c:a', 'aac', ...rate(audioKbps(target, quality))];
		case 'flac':
			return ['-c:a', 'flac'];
		case 'wav':
			return ['-c:a', 'pcm_s16le'];
		case 'aiff':
			return ['-c:a', 'pcm_s16be'];
	}
	throw new Error(`Can't make ${target} sound`);
}

export interface AudioOptions {
	/** The file has a cover: kept, where the format holds one */
	cover?: boolean;
	/** kbit/s, instead of the quality's */
	kbps?: number;
	/** Filters for the sound (the editor's: cut, fades, …) */
	filters?: string;
	/** A filter graph instead (the editor's parts put together), and its sound's label */
	graph?: { filter: string; audio: string };
}

/** FFmpeg's arguments for a file's sound alone, in this format, its tags (and cover) kept */
export function audioArgs(target: string, quality: Quality, options: AudioOptions = {}) {
	const cover =
		options.cover && WITH_COVER.has(target)
			? [
					'-map',
					'0:v:0?',
					'-c:v',
					'copy',
					'-disposition:v:0',
					'attached_pic',
					...(target === 'mp3' ? ['-id3v2_version', '3'] : [])
				]
			: ['-vn'];
	const sound = options.graph
		? ['-filter_complex', options.graph.filter, '-map', options.graph.audio]
		: ['-map', '0:a:0'];
	return [
		...sound,
		...cover,
		'-sn',
		'-map_metadata',
		'0',
		...(options.filters && !options.graph ? ['-af', options.filters] : []),
		...audioCodec(target, quality, options.kbps)
	];
}

/** Scaled to at most this many lines high (0: as it is), a width that divides by 2 */
export function scale(height: number) {
	return height ? `scale=-2:'min(${height},ih)'` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
}

export interface VideoOptions {
	/** At most this many lines high (0: as it is) */
	height?: number;
	/** kbit/s of the picture and of the sound, instead of the quality's */
	videoKbps?: number;
	audioKbps?: number;
	/** Filters for the picture and the sound (the editor's) */
	videoFilters?: string;
	audioFilters?: string;
	/** Without sound */
	mute?: boolean;
	/**
	 * A filter graph instead (the editor's parts put together, its filters and the scale in
	 * it), and its picture's and sound's labels
	 */
	graph?: { filter: string; video: string; audio?: string };
}

/** FFmpeg's arguments for a video in this format */
export function videoArgs(target: string, quality: Quality, options: VideoOptions = {}) {
	const { height = 0, videoKbps, audioKbps: aKbps, mute } = options;
	const vf = [options.videoFilters, scale(height)].filter(Boolean).join(',');
	const af = options.audioFilters ? ['-af', options.audioFilters] : [];
	const { graph } = options;
	const maps = graph
		? [
				'-filter_complex',
				graph.filter,
				'-map',
				graph.video,
				...(mute || !graph.audio ? ['-an'] : ['-map', graph.audio]),
				'-sn'
			]
		: ['-map', '0:v:0', ...(mute ? ['-an'] : ['-map', '0:a:0?', ...af]), '-sn'];
	/** The picture's filters (in the graph, if there's one) */
	const pic = graph ? [] : ['-vf', vf];
	const sound = (codec: string[], fallback: number) =>
		mute ? [] : [...codec, '-b:a', `${Math.round(aKbps ?? fallback)}k`];
	const rate = (kbps: number) => [
		'-b:v',
		`${Math.round(kbps)}k`,
		'-maxrate',
		`${Math.round(kbps * 1.4)}k`,
		'-bufsize',
		`${Math.round(kbps * 2)}k`
	];
	const crf = { small: '30', balanced: '23', best: '18' }[quality];
	const h264 = [
		'-c:v',
		'libx264',
		'-preset',
		'veryfast',
		...(videoKbps ? rate(videoKbps) : ['-crf', crf]),
		'-pix_fmt',
		'yuv420p'
	];
	const aac = sound(['-c:a', 'aac'], { small: 128, balanced: 160, best: 192 }[quality]);
	switch (target) {
		case 'mp4':
		case 'mov':
			return [...maps, ...pic, ...h264, ...aac, '-movflags', '+faststart'];
		case 'mkv':
			return [...maps, ...pic, ...h264, ...aac];
		case 'webm':
			return [
				...maps,
				...pic,
				'-c:v',
				'libvpx',
				'-deadline',
				'realtime',
				'-cpu-used',
				'5',
				...(videoKbps
					? rate(videoKbps)
					: [
							'-crf',
							{ small: '30', balanced: '16', best: '8' }[quality],
							'-b:v',
							{ small: '1M', balanced: '2500k', best: '6M' }[quality]
						]),
				...sound(['-c:a', 'libvorbis'], 160)
			];
		case 'avi':
			return [
				...maps,
				...pic,
				'-c:v',
				'mpeg4',
				...(videoKbps
					? rate(videoKbps)
					: ['-q:v', { small: '8', balanced: '5', best: '2' }[quality]]),
				...sound(['-c:a', 'libmp3lame'], 192)
			];
	}
	throw new Error(`Can't make ${target} videos`);
}

/** A GIF's filters: `fps` pictures a second, at most `width` wide, its own 256 colours */
export function gifChain(fps: number, width: number) {
	return `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`;
}

/** A GIF of a video: `fps` pictures a second, at most `width` wide */
export function gifArgs(fps: number, width: number, videoFilters?: string) {
	return [
		'-map',
		'0:v:0',
		'-an',
		'-vf',
		[
			videoFilters,
			`fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`
		]
			.filter(Boolean)
			.join(','),
		'-loop',
		'0'
	];
}

export const GIF_QUALITY: Record<Quality, { fps: number; width: number }> = {
	small: { fps: 10, width: 320 },
	balanced: { fps: 15, width: 480 },
	best: { fps: 20, width: 720 }
};

/** FFmpeg's arguments for a picture in a format the browser can't write (GIF, TIFF, WebP) */
export function imageArgs(target: string, quality: number) {
	switch (target) {
		case 'gif':
			return ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-frames:v', '1'];
		case 'tiff':
			return ['-c:v', 'tiff', '-compression_algo', 'deflate', '-frames:v', '1'];
		case 'webp':
			return ['-c:v', 'libwebp', '-quality', String(Math.round(quality * 100)), '-frames:v', '1'];
		case 'png':
			return ['-frames:v', '1'];
	}
	throw new Error(`Can't make ${target} pictures`);
}
