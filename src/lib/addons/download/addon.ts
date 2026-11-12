import type { Addon } from '../types';

export default {
	id: 'download',
	name: 'Downloader',
	summary: 'Videos and their sound from YouTube, Twitch and many more',
	description:
		'Paste a link and choose the video or only its sound, how good, and if you like just a part of it: a clip of a long stream is downloaded without the rest. Saved in Stosufy/Downloads.',
	highlights: [
		'YouTube, Twitch VODs and clips, TikTok, SoundCloud, X and hundreds more',
		'MP4 that plays everywhere, or the best quality there is (up to 8K)',
		'Only the sound: MP3, M4A, Opus, FLAC or WAV, with its cover',
		'Only a part: from–to, cut exactly, without downloading the rest',
		'Straight on to the file editor or the converter'
	],
	category: 'tools',
	icon: 'icon-[mingcute--download-3-line]',
	colors: ['#e11d48', '#7c3aed'],
	page: () => import('./Page.svelte')
} satisfies Addon;
