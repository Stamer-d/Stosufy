import type { Addon } from '../types';

export default {
	id: 'convert',
	name: 'File converter',
	summary: 'Turn files into other formats: pictures, sound, video, data and text',
	description:
		'Drop files in and pick what they should become. Everything is converted on your computer, nothing is uploaded, and the results land in Stosufy/Converted.',
	highlights: [
		'Pictures: PNG, JPG, WebP, GIF, BMP, TIFF, ICO and PDF',
		'Sound: MP3, WAV, FLAC, OGG, Opus, M4A and AIFF, also out of videos',
		'Video: MP4, WebM, MKV, MOV, AVI and GIF',
		'Data and text: JSON, YAML, TOML, CSV, XML, Markdown and HTML',
		'Many files at once, ZIPs packed and unpacked'
	],
	category: 'tools',
	icon: 'icon-[mingcute--transfer-line]',
	colors: ['#f59e0b', '#ef4444'],
	page: () => import('./Page.svelte')
} satisfies Addon;
