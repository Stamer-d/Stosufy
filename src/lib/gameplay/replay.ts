// osu! replays (.osr): who played, with which mods, and the cursor and keys over time.
// Format: https://osu.ppy.sh/wiki/en/Client/File_formats/osr_%28file_format%29

import { decompressLzma } from './lzma';

/** One moment of a replay: the cursor and the keys held (osu!'s bits: M1 1, M2 2, K1 4, K2 8) */
export interface Frame {
	time: number;
	x: number;
	y: number;
	keys: number;
}

export interface Replay {
	mode: number;
	beatmapHash: string;
	player: string;
	counts: { 300: number; 100: number; 50: number; geki: number; katu: number; miss: number };
	score: number;
	maxCombo: number;
	perfect: boolean;
	mods: number;
	timestamp: Date;
	frames: Frame[];
}

class Reader {
	private view: DataView;
	pos = 0;
	constructor(private data: Uint8Array) {
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}
	byte() {
		return this.data[this.pos++];
	}
	short() {
		const v = this.view.getUint16(this.pos, true);
		this.pos += 2;
		return v;
	}
	int() {
		const v = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return v;
	}
	long() {
		const v = this.view.getBigInt64(this.pos, true);
		this.pos += 8;
		return v;
	}
	uleb() {
		let result = 0;
		let shift = 0;
		for (;;) {
			const b = this.byte();
			result += (b & 0x7f) * 2 ** shift;
			if (!(b & 0x80)) return result;
			shift += 7;
		}
	}
	string() {
		if (this.byte() !== 0x0b) return '';
		const length = this.uleb();
		const text = new TextDecoder().decode(this.data.subarray(this.pos, this.pos + length));
		this.pos += length;
		return text;
	}
	bytes(length: number) {
		const out = this.data.subarray(this.pos, this.pos + length);
		this.pos += length;
		return out;
	}
}

/** .NET ticks (100 ns since year 1) to a date */
function ticksToDate(ticks: bigint) {
	const ms = Number(ticks / 10000n) - 62135596800000;
	return new Date(ms);
}

export function parseReplay(data: Uint8Array): Replay {
	const r = new Reader(data);
	const mode = r.byte();
	r.int(); // game version
	const beatmapHash = r.string();
	const player = r.string();
	r.string(); // replay hash
	const n300 = r.short();
	const n100 = r.short();
	const n50 = r.short();
	const geki = r.short();
	const katu = r.short();
	const miss = r.short();
	const score = r.int();
	const maxCombo = r.short();
	const perfect = r.byte() === 1;
	const mods = r.int();
	r.string(); // life bar
	const timestamp = ticksToDate(r.long());
	const length = r.int();
	const compressed = r.bytes(length);
	const text = new TextDecoder().decode(decompressLzma(compressed));

	const frames: Frame[] = [];
	let time = 0;
	for (const part of text.split(',')) {
		if (!part) continue;
		const [w, x, y, z] = part.split('|');
		const delta = Number(w);
		// The seed of the random number generator, at the end
		if (delta === -12345) continue;
		time += delta;
		// The first frames often are placeholders at 256, -500
		if (frames.length < 2 && Number(y) === -500) continue;
		frames.push({ time, x: Number(x), y: Number(y), keys: Number(z) | 0 });
	}
	// Frames are in the order they were recorded; a few can go back in time
	frames.sort((a, b) => a.time - b.time);
	return {
		mode,
		beatmapHash,
		player,
		counts: { 300: n300, 100: n100, 50: n50, geki, katu, miss },
		score,
		maxCombo,
		perfect,
		mods,
		timestamp,
		frames
	};
}
