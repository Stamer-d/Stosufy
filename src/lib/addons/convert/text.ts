// Text: Markdown, HTML and plain text into each other. Markdown is drawn by marked; HTML is
// read by the browser and walked for its text (and for Markdown, its headings, lists, links…).

import { marked } from 'marked';

const escapeHtml = (text: string) =>
	text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A whole page around some HTML, readable as it is */
function page(title: string, body: string) {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { max-width: 46rem; margin: 2rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; color: #1f2328; }
pre, code { font-family: ui-monospace, monospace; background: #f6f8fa; border-radius: 6px; }
pre { padding: 1rem; overflow: auto; } code { padding: .15em .35em; } pre code { padding: 0; }
blockquote { margin: 0; padding-left: 1rem; border-left: 4px solid #d0d7de; color: #59636e; }
table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: .3rem .7rem; }
img { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const BLOCKS = new Set([
	'ADDRESS',
	'ARTICLE',
	'ASIDE',
	'BLOCKQUOTE',
	'DD',
	'DIV',
	'DL',
	'DT',
	'FIELDSET',
	'FIGCAPTION',
	'FIGURE',
	'FOOTER',
	'FORM',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HEADER',
	'HR',
	'LI',
	'MAIN',
	'NAV',
	'OL',
	'P',
	'PRE',
	'SECTION',
	'TABLE',
	'TR',
	'UL'
]);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'SVG']);

function readHtml(html: string) {
	return new DOMParser().parseFromString(html, 'text/html');
}

/** The text of a page, with its paragraphs, lists and table rows on lines of their own */
export function htmlToText(html: string) {
	const out: string[] = [];
	const walk = (node: Node, pre: boolean) => {
		if (node.nodeType === 3) {
			out.push(pre ? node.textContent! : node.textContent!.replace(/\s+/g, ' '));
			return;
		}
		if (node.nodeType !== 1) return;
		const element = node as Element;
		const tag = element.tagName;
		if (SKIPPED.has(tag)) return;
		if (tag === 'BR') return void out.push('\n');
		const block = BLOCKS.has(tag);
		if (block) out.push('\n');
		if (tag === 'LI')
			out.push(element.parentElement?.tagName === 'OL' ? `${indexIn(element)}. ` : '• ');
		if (tag === 'TD' || tag === 'TH') if (element.previousElementSibling) out.push('\t');
		for (const child of Array.from(element.childNodes)) walk(child, pre || tag === 'PRE');
		if (block) out.push('\n');
		if (/^(P|H[1-6]|BLOCKQUOTE|PRE|TABLE|UL|OL)$/.test(tag)) out.push('\n');
	};
	walk(readHtml(html).body, false);
	return (
		out
			.join('')
			.split('\n')
			.map((line) => line.replace(/^ +| +$/g, ''))
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim() + '\n'
	);
}

function indexIn(item: Element) {
	return Array.from(item.parentElement!.children).indexOf(item) + 1;
}

/** Markdown of a page: headings, paragraphs, emphasis, links, pictures, lists, code, quotes */
export function htmlToMarkdown(html: string) {
	const inline = (node: Node): string => {
		if (node.nodeType === 3)
			return node.textContent!.replace(/\s+/g, ' ').replace(/([*_`[\]])/g, '\\$1');
		if (node.nodeType !== 1) return '';
		const element = node as Element;
		const inner = () => Array.from(element.childNodes).map(inline).join('');
		switch (element.tagName) {
			case 'STRONG':
			case 'B':
				return `**${inner().trim()}**`;
			case 'EM':
			case 'I':
				return `*${inner().trim()}*`;
			case 'CODE':
				return '`' + element.textContent + '`';
			case 'A':
				return `[${inner().trim()}](${element.getAttribute('href') ?? ''})`;
			case 'IMG':
				return `![${element.getAttribute('alt') ?? ''}](${element.getAttribute('src') ?? ''})`;
			case 'BR':
				return '  \n';
			default:
				return SKIPPED.has(element.tagName) ? '' : block(element);
		}
	};
	const block = (element: Element, depth = 0): string => {
		const children = () => Array.from(element.childNodes).map(inline).join('');
		const tag = element.tagName;
		const heading = /^H([1-6])$/.exec(tag);
		if (heading) return `\n\n${'#'.repeat(+heading[1])} ${children().trim()}\n\n`;
		switch (tag) {
			case 'P':
				return `\n\n${children().trim()}\n\n`;
			case 'HR':
				return '\n\n---\n\n';
			case 'PRE':
				return `\n\n\`\`\`\n${element.textContent!.replace(/\n$/, '')}\n\`\`\`\n\n`;
			case 'BLOCKQUOTE':
				return `\n\n${children()
					.trim()
					.split('\n')
					.map((line) => `> ${line}`)
					.join('\n')}\n\n`;
			case 'UL':
			case 'OL':
				return (
					'\n\n' +
					Array.from(element.children)
						.filter((item) => item.tagName === 'LI')
						.map((item, i) => {
							const mark = tag === 'OL' ? `${i + 1}.` : '-';
							const text = Array.from(item.childNodes)
								.map((child) =>
									child.nodeType === 1 && /^(UL|OL)$/.test((child as Element).tagName)
										? block(child as Element, depth + 1)
										: inline(child)
								)
								.join('')
								.trim();
							return `${'  '.repeat(depth)}${mark} ${text}`;
						})
						.join('\n') +
					'\n\n'
				);
			default:
				return BLOCKS.has(tag) ? `\n${children()}\n` : children();
		}
	};
	return (
		block(readHtml(html).body)
			.split('\n')
			.map((line) => line.replace(/[ \t]+$/g, (end) => (end === '  ' ? end : '')))
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim() + '\n'
	);
}

/** Text as a page: its paragraphs as paragraphs, its lines as lines */
function textToHtml(text: string, title: string) {
	const body = text
		.replace(/\r\n?/g, '\n')
		.split(/\n{2,}/)
		.filter((part) => part.trim())
		.map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>\n')}</p>`)
		.join('\n');
	return page(title, body);
}

/** The first heading of some Markdown, else the file's name */
function titleOf(markdown: string, fallback: string) {
	return /^#{1,6}\s+(.+)$/m.exec(markdown)?.[1].trim() ?? fallback;
}

export function convertText(text: string, from: string, to: string, name: string): string {
	if (from === 'md' && to === 'html')
		return page(titleOf(text, name), marked.parse(text, { async: false }) as string);
	if (from === 'md' && to === 'txt')
		return htmlToText(marked.parse(text, { async: false }) as string);
	if (from === 'html' && to === 'txt') return htmlToText(text);
	if (from === 'html' && to === 'md') return htmlToMarkdown(text);
	if (from === 'txt' && to === 'html') return textToHtml(text, name);
	// (plain text is Markdown already: only what would be read as formatting is escaped)
	if (from === 'txt' && to === 'md') return text.replace(/([\\`*_[\]#<>])/g, '\\$1');
	throw new Error(`Can't make ${to} of ${from}`);
}
