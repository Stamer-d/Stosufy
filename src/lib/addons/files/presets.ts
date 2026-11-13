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
	/** The source's pictures a second: made constant at the standard rate nearest to it */
	fps?: number;
}

/** The video rates editors know (NTSC's exactly: 60000/1001, not 59.94) */
const RATES: [number, string][] = [
	[24000 / 1001, '24000/1001'],
	[24, '24'],
	[25, '25'],
	[30000 / 1001, '30000/1001'],
	[30, '30'],
	[48, '48'],
	[50, '50'],
	[60000 / 1001, '60000/1001'],
	[60, '60'],
	[100, '100'],
	[120000 / 1001, '120000/1001'],
	[120, '120'],
	[144, '144'],
	[240, '240']
];

/** The standard rate a video's is (within half a percent), else its own rounded; null: unknown */
export function standardRate(fps: number | undefined): { rate: string; fps: number } | null {
	if (!fps || !Number.isFinite(fps) || fps < 1 || fps > 1000) return null;
	const near = RATES.find(([value]) => Math.abs(value - fps) / value < 0.005);
	if (near) return { rate: near[1], fps: near[0] };
	const own = Math.round(fps * 1000) / 1000;
	return { rate: String(own), fps: own };
}

/** The video codecs and sound codecs each container holds as they are (repacked, not made again) */
const HOLDS: Record<string, { video: string[]; audio: string[] }> = {
	mp4: { video: ['h264', 'hevc', 'av1'], audio: ['aac', 'mp3', 'alac'] },
	mov: { video: ['h264', 'hevc', 'prores'], audio: ['aac', 'alac', 'pcm_s16le', 'pcm_s24le'] },
	mkv: {
		video: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4'],
		audio: ['aac', 'opus', 'vorbis', 'mp3', 'flac', 'ac3', 'eac3']
	},
	webm: { video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'] },
	// (what Premiere and After Effects read without trouble: H.264, 8 bits, AAC)
	editing: { video: ['h264'], audio: ['aac'] }
};

/** What a video is, for `canRepack` (from its probe) */
export interface VideoSource {
	videoCodec: string;
	audioCodec: string;
	audio: boolean;
	height: number;
	fps: number;
	pixelFormat: string;
	timeBase: string;
}

/**
 * Whether a video can be put into `target` as it is (in seconds, nothing lost): its picture's
 * and sound's codecs fit, it isn't to be made smaller. Into an MP4 or MOV also only evenly
 * timed (`evenlyTimed`), for editing also in 8 bits: an MKV's or WebM's (timed in
 * milliseconds, unevenly) is made again, so that Premiere doesn't stutter.
 */
export function canRepack(target: string, source: VideoSource | null, height = 0) {
	const holds = HOLDS[target];
	if (!holds || !source?.videoCodec) return false;
	if (!holds.video.includes(source.videoCodec)) return false;
	if (source.audio && !holds.audio.includes(source.audioCodec)) return false;
	if (height && source.height > height) return false;
	// MP4 and MOV go into editors (Premiere stutters on uneven pictures): repacked only where
	// they're evenly timed; MKV and WebM as they come
	if (target === 'editing') return evenlyTimed(source) && /^yuvj?420p$/.test(source.pixelFormat);
	if (target === 'mp4' || target === 'mov') return evenlyTimed(source);
	return true;
}

/**
 * Whether a video's pictures are evenly timed at a standard rate: each a whole number of its
 * time base's ticks long, as a camera's or an editor's are; not an MKV's milliseconds, nor
 * 19001ths of a second for 59.94 fps (as a file converted from an MKV before had)
 */
export function evenlyTimed(source: VideoSource) {
	const standard = standardRate(source.fps);
	if (!standard || Math.abs(standard.fps - source.fps) > 0.01) return false;
	const each = ticksOf(source.timeBase) / standard.fps;
	return each >= 1 && Math.abs(each - Math.round(each)) < 1e-6;
}

/** A time base as FFmpeg says it ("15360", "1k", "90k"): its ticks a second (0: unknown) */
function ticksOf(timeBase: string) {
	const match = /^(\d+(?:\.\d+)?)(k?)$/.exec(timeBase);
	return match ? Number(match[1]) * (match[2] ? 1000 : 1) : 0;
}

/** FFmpeg's arguments for a video put into `target` as it is (repacked) */
export function repackArgs(target: string, source: VideoSource) {
	const mp4 = target === 'mp4' || target === 'mov' || target === 'editing';
	return [
		'-map',
		'0:v:0',
		'-map',
		'0:a:0?',
		'-sn',
		'-dn',
		'-c',
		'copy',
		// (HEVC as Apple and Adobe want it marked)
		...(mp4 && source.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
		...(mp4 ? ['-movflags', '+faststart'] : [])
	];
}

/** FFmpeg's arguments for a video in this format */
export function videoArgs(target: string, quality: Quality, options: VideoOptions = {}) {
	const { height = 0, videoKbps, audioKbps: aKbps, mute } = options;
	const vf = [options.videoFilters, scale(height)].filter(Boolean).join(',');
	// (the sound kept with the picture where the source's has gaps or starts late: stretched
	// or filled, from 0; editors like Premiere stutter on such files otherwise)
	const af = [
		'-af',
		['aresample=async=1:first_pts=0', options.audioFilters].filter(Boolean).join(',')
	];
	const { graph } = options;
	// A constant frame rate, a standard one, with a keyframe every 2 s: a file editors (Premiere,
	// After Effects, Resolve) play smoothly, whatever its timestamps were (a stream cut out,
	// MKV's in milliseconds)
	const standard = standardRate(options.fps);
	const constant = standard
		? [
				'-fps_mode',
				'cfr',
				'-r',
				standard.rate,
				'-g',
				String(Math.max(1, Math.round(standard.fps * 2)))
			]
		: [];
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
	const pic = [...(graph ? [] : ['-vf', vf]), ...constant];
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
	// (for editing: as good as it gets, whatever quality's chosen; a little slower for it)
	const editing = target === 'editing';
	const crf = editing ? '16' : { small: '30', balanced: '23', best: '18' }[quality];
	const h264 = [
		'-c:v',
		'libx264',
		'-preset',
		editing ? 'fast' : 'veryfast',
		...(videoKbps ? rate(videoKbps) : ['-crf', crf]),
		...(editing ? ['-profile:v', 'high'] : []),
		'-pix_fmt',
		'yuv420p'
	];
	const aac = sound(
		['-c:a', 'aac', '-ar', '48000'],
		{ small: 128, balanced: 160, best: 192 }[quality]
	);
	switch (target) {
		case 'editing':
			return [
				...maps,
				...pic,
				// (a constant rate even where the source's is unknown)
				...(constant.length ? [] : ['-fps_mode', 'cfr']),
				...h264,
				...sound(['-c:a', 'aac', '-ar', '48000'], 320),
				'-movflags',
				'+faststart'
			];
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
	return `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[gif1][gif2];[gif1]palettegen[gifp];[gif2][gifp]paletteuse`;
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
			`fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[gif1][gif2];[gif1]palettegen[gifp];[gif2][gifp]paletteuse`
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
			return [
				'-vf',
				'split[gif1][gif2];[gif1]palettegen[gifp];[gif2][gifp]paletteuse',
				'-frames:v',
				'1'
			];
		case 'tiff':
			return ['-c:v', 'tiff', '-compression_algo', 'deflate', '-frames:v', '1'];
		case 'webp':
			return ['-c:v', 'libwebp', '-quality', String(Math.round(quality * 100)), '-frames:v', '1'];
		case 'png':
			return ['-frames:v', '1'];
	}
	throw new Error(`Can't make ${target} pictures`);
}
