// The file converter's formats: what a file is (by its extension, else its type), and what it
// can be made into. Which code does the work is in convert.ts.

export type Kind = 'image' | 'audio' | 'video' | 'data' | 'text' | 'archive' | 'other';

export interface Format {
	id: string;
	/** As it's shown */
	label: string;
	kind: Kind;
	/** The extensions it's known by, the first one is what it's saved as */
	extensions: string[];
	/** Only read, never made (SVG, AVIF, …) */
	readOnly?: boolean;
}

export const FORMATS: Format[] = [
	// Images
	{ id: 'png', label: 'PNG', kind: 'image', extensions: ['png', 'apng'] },
	{ id: 'jpg', label: 'JPG', kind: 'image', extensions: ['jpg', 'jpeg', 'jfif', 'jpe'] },
	{ id: 'webp', label: 'WebP', kind: 'image', extensions: ['webp'] },
	{ id: 'gif', label: 'GIF', kind: 'image', extensions: ['gif'] },
	{ id: 'bmp', label: 'BMP', kind: 'image', extensions: ['bmp', 'dib'] },
	{ id: 'tiff', label: 'TIFF', kind: 'image', extensions: ['tiff', 'tif'] },
	{ id: 'ico', label: 'ICO', kind: 'image', extensions: ['ico'] },
	{ id: 'avif', label: 'AVIF', kind: 'image', extensions: ['avif'], readOnly: true },
	{ id: 'svg', label: 'SVG', kind: 'image', extensions: ['svg'], readOnly: true },
	{ id: 'pdf', label: 'PDF', kind: 'image', extensions: ['pdf'] },
	// Audio
	{ id: 'mp3', label: 'MP3', kind: 'audio', extensions: ['mp3'] },
	{ id: 'wav', label: 'WAV', kind: 'audio', extensions: ['wav', 'wave'] },
	{ id: 'flac', label: 'FLAC', kind: 'audio', extensions: ['flac'] },
	{ id: 'ogg', label: 'OGG', kind: 'audio', extensions: ['ogg', 'oga'] },
	{ id: 'opus', label: 'Opus', kind: 'audio', extensions: ['opus'] },
	{ id: 'm4a', label: 'M4A (AAC)', kind: 'audio', extensions: ['m4a', 'aac', 'mp4a'] },
	{ id: 'aiff', label: 'AIFF', kind: 'audio', extensions: ['aiff', 'aif', 'aifc'] },
	{ id: 'wma', label: 'WMA', kind: 'audio', extensions: ['wma'], readOnly: true },
	{ id: 'amr', label: 'AMR', kind: 'audio', extensions: ['amr'], readOnly: true },
	// Video
	{ id: 'mp4', label: 'MP4', kind: 'video', extensions: ['mp4', 'm4v'] },
	{ id: 'webm', label: 'WebM', kind: 'video', extensions: ['webm'] },
	{ id: 'mkv', label: 'MKV', kind: 'video', extensions: ['mkv'] },
	{ id: 'mov', label: 'MOV', kind: 'video', extensions: ['mov', 'qt'] },
	{ id: 'avi', label: 'AVI', kind: 'video', extensions: ['avi'] },
	{ id: 'flv', label: 'FLV', kind: 'video', extensions: ['flv'], readOnly: true },
	{ id: 'wmv', label: 'WMV', kind: 'video', extensions: ['wmv', 'asf'], readOnly: true },
	{
		id: 'mpeg',
		label: 'MPEG',
		kind: 'video',
		extensions: ['mpg', 'mpeg', 'ts', 'm2ts', 'mts', 'vob'],
		readOnly: true
	},
	{ id: '3gp', label: '3GP', kind: 'video', extensions: ['3gp', '3g2'], readOnly: true },
	// Data
	{ id: 'json', label: 'JSON', kind: 'data', extensions: ['json'] },
	{ id: 'yaml', label: 'YAML', kind: 'data', extensions: ['yaml', 'yml'] },
	{ id: 'toml', label: 'TOML', kind: 'data', extensions: ['toml'] },
	{ id: 'csv', label: 'CSV', kind: 'data', extensions: ['csv'] },
	{ id: 'tsv', label: 'TSV', kind: 'data', extensions: ['tsv', 'tab'] },
	{ id: 'xml', label: 'XML', kind: 'data', extensions: ['xml'] },
	// Text
	{ id: 'md', label: 'Markdown', kind: 'text', extensions: ['md', 'markdown', 'mdown'] },
	{ id: 'html', label: 'HTML', kind: 'text', extensions: ['html', 'htm', 'xhtml'] },
	{ id: 'txt', label: 'Text', kind: 'text', extensions: ['txt', 'text', 'log'] },
	// Archives
	{ id: 'zip', label: 'ZIP', kind: 'archive', extensions: ['zip', 'osz', 'osk'] }
];

/** What any file can be made into */
export const ANY_TARGETS = ['zip', 'base64'];

export interface Target {
	id: string;
	label: string;
	/** What it's saved as */
	extension: string;
	/** In the menu, under */
	group: string;
}

const formatById = new Map(FORMATS.map((format) => [format.id, format]));
const formatByExtension = new Map(
	FORMATS.flatMap((format) => format.extensions.map((extension) => [extension, format]))
);

const MIME_KINDS: [RegExp, string][] = [
	[/^image\/svg/, 'svg'],
	[/^image\/jpe?g/, 'jpg'],
	[/^image\/png/, 'png'],
	[/^image\/webp/, 'webp'],
	[/^image\/gif/, 'gif'],
	[/^audio\/mpeg/, 'mp3'],
	[/^audio\/(wav|x-wav|wave)/, 'wav'],
	[/^audio\/(ogg|vorbis)/, 'ogg'],
	[/^audio\/flac/, 'flac'],
	[/^video\/mp4/, 'mp4'],
	[/^video\/webm/, 'webm'],
	[/^application\/json/, 'json'],
	[/^text\/html/, 'html'],
	[/^text\/markdown/, 'md'],
	[/^text\/plain/, 'txt'],
	[/^(application|text)\/xml/, 'xml'],
	[/^text\/csv/, 'csv'],
	[/^application\/(zip|x-zip)/, 'zip']
];

export function extensionOf(name: string) {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseName(name: string) {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

/** What a file is, or null when it's none of these (it can still be zipped and encoded) */
export function detectFormat(file: { name: string; type?: string }): Format | null {
	const byExtension = formatByExtension.get(extensionOf(file.name));
	if (byExtension) return byExtension;
	const type = file.type ?? '';
	for (const [pattern, id] of MIME_KINDS) if (pattern.test(type)) return formatById.get(id)!;
	if (/^image\//.test(type)) return { id: 'image', label: 'Image', kind: 'image', extensions: [] };
	if (/^audio\//.test(type)) return { id: 'audio', label: 'Audio', kind: 'audio', extensions: [] };
	if (/^video\//.test(type)) return { id: 'video', label: 'Video', kind: 'video', extensions: [] };
	return null;
}

const IMAGE_TARGETS = ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'];
const AUDIO_TARGETS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aiff'];
const VIDEO_TARGETS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
const DATA_TARGETS = ['json', 'yaml', 'toml', 'csv', 'tsv', 'xml'];
const TEXT_TARGETS: Record<string, string[]> = {
	md: ['html', 'txt'],
	html: ['txt', 'md'],
	txt: ['html', 'md']
};

function target(id: string, group: string): Target {
	if (id === 'base64') return { id, label: 'Base64 text', extension: 'txt', group };
	if (id === 'zip') return { id, label: 'ZIP', extension: 'zip', group };
	if (id === 'unzip') return { id, label: 'Unpack the files', extension: '', group };
	const format = formatById.get(id)!;
	return { id, label: format.label, extension: format.extensions[0], group };
}

/** What a file of this format can be made into, by group, the most likely first */
export function targetsFor(format: Format | null): Target[] {
	const not = (id: string) => (other: string) => other !== id;
	const own: Target[] = [];
	switch (format?.kind) {
		case 'image':
			own.push(...IMAGE_TARGETS.filter(not(format.id)).map((id) => target(id, 'Image')));
			break;
		case 'audio':
			own.push(...AUDIO_TARGETS.filter(not(format.id)).map((id) => target(id, 'Audio')));
			break;
		case 'video':
			own.push(...VIDEO_TARGETS.filter(not(format.id)).map((id) => target(id, 'Video')));
			own.push(...AUDIO_TARGETS.map((id) => target(id, 'Only the sound')));
			break;
		case 'data':
			own.push(...DATA_TARGETS.filter(not(format.id)).map((id) => target(id, 'Data')));
			break;
		case 'text':
			own.push(...(TEXT_TARGETS[format.id] ?? []).map((id) => target(id, 'Text')));
			break;
		case 'archive':
			own.push(target('unzip', 'Archive'));
			break;
	}
	// A PDF is read as nothing but a file
	if (format?.id === 'pdf') own.length = 0;
	const any = ANY_TARGETS.filter((id) => !(id === 'zip' && format?.kind === 'archive'));
	return [...own, ...any.map((id) => target(id, 'Any file'))];
}

export function kindOf(format: Format | null): Kind {
	return format?.id === 'pdf' ? 'other' : (format?.kind ?? 'other');
}
