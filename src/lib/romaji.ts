// Japanese to romaji for lyrics. Kanji need a dictionary to find their reading: kuromoji
// splits the text into words with readings (its dictionary, ~18 MB, downloads once on first
// use and stays in the browser cache), wanakana turns the readings into romaji.

import { toRomaji } from 'wanakana';

const DICTIONARY = 'https://cdn.jsdelivr.net/npm/@sglkc/kuromoji@1.1.0/dict/';
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

type Token = {
	surface_form: string;
	reading?: string;
	pos: string;
	pos_detail_1: string;
};
type Tokenizer = { tokenize(text: string): Token[] };

let tokenizer: Promise<Tokenizer> | null = null;

function getTokenizer() {
	tokenizer ??= import('@sglkc/kuromoji').then(
		({ default: kuromoji }) =>
			new Promise<Tokenizer>((resolve, reject) => {
				kuromoji.builder({ dicPath: DICTIONARY }).build((error: unknown, result: Tokenizer) => {
					if (error) {
						tokenizer = null;
						reject(error);
					} else resolve(result);
				});
			})
	);
	return tokenizer;
}

export function hasJapanese(text: string | null | undefined) {
	return !!text && JAPANESE.test(text);
}

/** Japanese punctuation in its Latin form */
const PUNCTUATION: Record<string, string> = {
	'、': ', ',
	'。': '. ',
	'！': '! ',
	'？': '? ',
	'「': ' "',
	'」': '" ',
	'『': ' "',
	'』': '" ',
	'（': ' (',
	'）': ') ',
	'〜': '~',
	'～': '~',
	'・': ' ',
	'…': '… ',
	'　': ' '
};

/** Particles that are read differently than written */
const PARTICLES: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' };

/** Whether a word belongs to the one before (verb endings, suffixes): no space between */
function attaches(token: Token) {
	return (
		token.pos === '助動詞' ||
		token.pos_detail_1 === '接尾' ||
		(token.pos === '動詞' && token.pos_detail_1 === '非自立') ||
		(token.pos === '助詞' &&
			token.pos_detail_1 === '接続助詞' &&
			/^[てで]$/.test(token.surface_form))
	);
}

export function romanizeLine(tokens: Token[]) {
	let out = '';
	let lastJapanese = false;
	for (const token of tokens) {
		const surface = token.surface_form;
		if (!JAPANESE.test(surface)) {
			out += surface.replace(/[、。！？「」『』（）〜～・…　]/g, (mark) => PUNCTUATION[mark]);
			lastJapanese = false;
			continue;
		}
		const reading = token.reading && token.reading !== '*' ? token.reading : surface;
		const romaji =
			token.pos === '助詞' && PARTICLES[surface] ? PARTICLES[surface] : toRomaji(reading);
		// A space between words, not after an opening quote or within a verb
		const afterWord = /[\p{L}\p{N},.!?)…~]$/u.test(out);
		if (afterWord && !(lastJapanese && attaches(token))) out += ' ';
		out += romaji;
		lastJapanese = true;
	}
	return out
		.replace(/\s+([,.!?)])/g, '$1')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** The lines in romaji; lines without Japanese stay as they are */
export async function romanize(lines: string[]): Promise<string[]> {
	if (!lines.some(hasJapanese)) return lines;
	const tokenizer = await getTokenizer();
	return lines.map((line) => {
		if (!hasJapanese(line)) return line;
		const romaji = romanizeLine(tokenizer.tokenize(line));
		// Start lines with a capital letter, like other lyrics
		return romaji.replace(
			/^([^\p{L}]*)(\p{L})/u,
			(_, before, letter) => before + letter.toUpperCase()
		);
	});
}
