// Data files: read into plain values (objects, lists, text, numbers) and written in another
// format. JSON, YAML and TOML say the same things; a table (CSV, TSV) is a list of rows, XML a
// tree of elements (attributes as "@name", text as "#text" where an element has both).

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

type Value = unknown;

// --- Tables ---------------------------------------------------------------------------------

/** The rows of a CSV (or with another separator), quotes and line breaks in cells included */
export function parseDelimited(text: string, separator: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	for (; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += char;
		} else if (char === '"' && cell === '') quoted = true;
		else if (char === separator) {
			row.push(cell);
			cell = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += char;
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((cells) => cells.some((cell) => cell !== ''));
}

/**
 * A cell's text as what it is, for formats that tell them apart (JSON, YAML, …): a number
 * (only where it's written as one would write it back: "1.50", "007" or "1e5" stay text),
 * true or false, or the text. Kept as text from table to table.
 */
function cellValue(cell: string, typed: boolean): Value {
	if (!typed) return cell;
	if (cell !== '' && Number.isFinite(Number(cell)) && String(Number(cell)) === cell)
		return Number(cell);
	if (cell === 'true') return true;
	if (cell === 'false') return false;
	return cell;
}

function tableToRows(text: string, separator: string, typed: boolean) {
	const [header, ...rows] = parseDelimited(text, separator);
	if (!header) return [];
	// (each column a name of its own: "Notes", "Notes 2")
	const seen = new Map<string, number>();
	const names = header.map((name, i) => {
		const base = name.trim() || `column${i + 1}`;
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		return count > 1 ? `${base} ${count}` : base;
	});
	return rows.map((cells) => {
		const row: Record<string, Value> = {};
		names.forEach((name, i) => {
			setPath(row, name, cellValue(cells[i] ?? '', typed));
		});
		return row;
	});
}

/** An object with keys (not a list, a date or a number) */
const isPlain = (value: Value): value is Record<string, Value> =>
	!!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/** A value as a cell's text */
function scalarText(value: Value) {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

/** `a.b` in a header is the `b` in an `a` (what flattening made of it) */
function setPath(row: Record<string, Value>, name: string, value: Value) {
	const keys = name.split('.');
	if (keys.length === 1 || keys.some((key) => !key)) {
		row[name] = value;
		return;
	}
	let at: Record<string, Value> = row;
	for (const key of keys.slice(0, -1)) {
		const next = at[key];
		if (next && typeof next === 'object' && !Array.isArray(next))
			at = next as Record<string, Value>;
		else at = at[key] = {};
	}
	at[keys.at(-1)!] = value;
}

/**
 * The list of rows in a value: itself, or the one list in it when nothing else is beside it
 * but more lists and objects (a wrapper like {"items": [...]}); else it's one row (nothing
 * of it left out)
 */
function rowsIn(value: Value): Value[] {
	if (Array.isArray(value)) return value;
	if (isPlain(value)) {
		const values = Object.values(value);
		const lists = values.filter(Array.isArray);
		const wrapper = values.every((inner) => Array.isArray(inner) || isPlain(inner));
		if (lists.length === 1 && wrapper) return lists[0];
		const objects = values.filter(isPlain);
		if (values.length === 1 && objects.length === 1) return rowsIn(objects[0]);
		return [value];
	}
	return [{ value }];
}

function flatten(value: Value, prefix: string, into: Record<string, string>) {
	if (isPlain(value)) {
		const entries = Object.entries(value);
		if (!entries.length && prefix) into[prefix] = '';
		for (const [key, inner] of entries) flatten(inner, prefix ? `${prefix}.${key}` : key, into);
	} else if (Array.isArray(value)) {
		into[prefix || 'value'] = value.every((item) => !isPlain(item) && !Array.isArray(item))
			? value.map(scalarText).join('; ')
			: toJson(value, false);
	} else into[prefix || 'value'] = scalarText(value);
}

function rowsToTable(value: Value, separator: string) {
	const rows = rowsIn(value).map((row) => {
		const flat: Record<string, string> = {};
		flatten(row, '', flat);
		return flat;
	});
	const known = new Set<string>();
	for (const row of rows) for (const name of Object.keys(row)) known.add(name);
	const names = [...known];
	const cell = (text: string) =>
		new RegExp(`["\\r\\n${separator === '\t' ? '\\t' : separator}]`).test(text) ||
		/^\s|\s$/.test(text)
			? `"${text.replaceAll('"', '""')}"`
			: text;
	return [names, ...rows.map((row) => names.map((name) => row[name] ?? ''))]
		.map((cells) => cells.map(cell).join(separator))
		.join('\r\n')
		.concat('\r\n');
}

// --- XML ------------------------------------------------------------------------------------

function elementToValue(element: Element, typed: boolean): Value {
	const out: Record<string, Value> = {};
	for (const attribute of Array.from(element.attributes))
		out[`@${attribute.name}`] = attribute.value;
	const children = Array.from(element.children);
	const text = Array.from(element.childNodes)
		.filter((node) => node.nodeType === 3 || node.nodeType === 4)
		.map((node) => node.textContent)
		.join('')
		.trim();
	if (!children.length && !element.attributes.length) return cellValue(text, typed);
	for (const child of children) {
		const value = elementToValue(child, typed);
		const name = child.tagName;
		if (name in out) {
			const before = out[name];
			out[name] = Array.isArray(before) ? [...before, value] : [before, value];
		} else out[name] = value;
	}
	if (text) out['#text'] = cellValue(text, typed);
	return out;
}

function parseXml(text: string, typed: boolean): Value {
	const doc = new DOMParser().parseFromString(text, 'application/xml');
	const error = doc.querySelector('parsererror');
	if (error) throw new Error(`Not valid XML: ${error.textContent?.split('\n')[0] ?? ''}`.trim());
	const root = doc.documentElement;
	return { [root.tagName]: elementToValue(root, typed) };
}

const escapeXml = (text: string) =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

function xmlName(name: string) {
	const clean = name.replace(/[^A-Za-z0-9_.:-]/g, '_');
	return /^[A-Za-z_]/.test(clean) ? clean : `_${clean}`;
}

function valueToXml(name: string, value: Value, depth: number): string {
	const pad = '  '.repeat(depth);
	const tag = xmlName(name);
	if (Array.isArray(value)) return value.map((item) => valueToXml(name, item, depth)).join('');
	if (value === null || value === undefined) return `${pad}<${tag}/>\n`;
	if (!isPlain(value)) return `${pad}<${tag}>${escapeXml(scalarText(value))}</${tag}>\n`;
	const entries = Object.entries(value);
	const attributes = entries
		.filter(([key, inner]) => key.startsWith('@') && !isPlain(inner) && !Array.isArray(inner))
		.map(([key, inner]) => ` ${xmlName(key.slice(1))}="${escapeXml(scalarText(inner))}"`)
		.join('');
	const text = (value as Record<string, Value>)['#text'];
	const children = entries.filter(([key]) => !key.startsWith('@') && key !== '#text');
	if (!children.length)
		return text === undefined
			? `${pad}<${tag}${attributes}/>\n`
			: `${pad}<${tag}${attributes}>${escapeXml(scalarText(text))}</${tag}>\n`;
	return (
		`${pad}<${tag}${attributes}>\n` +
		(text === undefined ? '' : `${pad}  ${escapeXml(scalarText(text))}\n`) +
		children.map(([key, inner]) => valueToXml(key, inner, depth + 1)).join('') +
		`${pad}</${tag}>\n`
	);
}

function stringifyXml(value: Value) {
	const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const keys = Object.keys(value);
		if (keys.length === 1 && !Array.isArray((value as Record<string, Value>)[keys[0]]))
			return head + valueToXml(keys[0], (value as Record<string, Value>)[keys[0]], 0);
		return head + valueToXml('root', value, 0);
	}
	if (Array.isArray(value)) return head + valueToXml('root', { item: value }, 0);
	return head + valueToXml('root', value, 0);
}

// --- TOML -----------------------------------------------------------------------------------

/** TOML has no "nothing": left out */
function withoutNulls(value: Value): Value {
	if (Array.isArray(value)) return value.filter((item) => item !== null).map(withoutNulls);
	if (isPlain(value))
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, inner]) => inner !== null && inner !== undefined)
				.map(([key, inner]) => [key, withoutNulls(inner)])
		);
	return value;
}

function toToml(value: Value) {
	const table =
		value && typeof value === 'object' && !Array.isArray(value)
			? value
			: Array.isArray(value)
				? { items: value }
				: { value };
	try {
		return stringifyToml(withoutNulls(table) as Record<string, unknown>);
	} catch (error) {
		throw new Error(`Can't be TOML: ${(error as Error).message}`);
	}
}

// --- JSON -------------------------------------------------------------------------------------

/** JSON, big integers written exactly (as the digits they are) */
function toJson(value: Value, pretty: boolean) {
	const json = JSON.stringify(
		value,
		(_, inner) => (typeof inner === 'bigint' ? `\u0000big:${inner}` : inner),
		pretty ? 2 : undefined
	);
	return json.replace(/"\\u0000big:(-?\d+)"/g, '$1');
}

// --- Everything -----------------------------------------------------------------------------

/**
 * A data file read: `typed` keeps numbers and true/false apart from text (false from table to
 * table: every cell stays as it's written)
 */
export function parseData(text: string, format: string, typed = true): Value {
	try {
		switch (format) {
			case 'json':
				return JSON.parse(text.replace(/^﻿/, ''));
			case 'yaml':
				return parseYaml(text);
			case 'toml':
				// (integers too big for JavaScript's numbers kept exact)
				return parseToml(text, { integersAsBigInt: 'asNeeded' });
			case 'csv':
				return tableToRows(text, guessSeparator(text), typed);
			case 'tsv':
				return tableToRows(text, '\t', typed);
			case 'xml':
				return parseXml(text, typed);
		}
	} catch (error) {
		const message = (error as Error).message.split('\n')[0];
		throw new Error(
			message.startsWith('Not valid') ? message : `Not valid ${format.toUpperCase()}: ${message}`
		);
	}
	throw new Error(`Can't read ${format}`);
}

/** A CSV's separator: a comma, or the semicolon of a German Excel, or a tab */
function guessSeparator(text: string) {
	const line = text.split(/\r?\n/, 1)[0];
	const count = (char: string) => line.split(char).length - 1;
	const best = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
	return count(best) ? best : ',';
}

export function stringifyData(value: Value, format: string): string {
	switch (format) {
		case 'json':
			return toJson(value, true) + '\n';
		case 'yaml':
			return stringifyYaml(value);
		case 'toml':
			return toToml(value);
		case 'csv':
			return rowsToTable(value, ',');
		case 'tsv':
			return rowsToTable(value, '\t');
		case 'xml':
			return stringifyXml(value);
	}
	throw new Error(`Can't write ${format}`);
}
