// A small LZMA decoder for the "LZMA alone" format osu! replays (.osr) use for their cursor
// movements: a 13 byte header (properties, dictionary size, unpacked size) and the stream.
// After the reference decoder in Igor Pavlov's LZMA SDK (LzmaSpec.cpp, public domain).

const PROB_INIT = 1024;
const TOP = 1 << 24;

class RangeDecoder {
	private range = 0xffffffff;
	private code = 0;
	pos: number;

	constructor(
		private data: Uint8Array,
		start: number
	) {
		this.pos = start + 1; // the first byte is always 0
		for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.byte()) >>> 0;
	}

	private byte() {
		return this.pos < this.data.length ? this.data[this.pos++] : 0;
	}

	private normalize() {
		if (this.range < TOP) {
			this.range = (this.range << 8) >>> 0;
			this.code = ((this.code << 8) | this.byte()) >>> 0;
		}
	}

	direct(bits: number) {
		let result = 0;
		while (bits--) {
			this.range >>>= 1;
			let bit = 0;
			if (this.code >= this.range) {
				this.code = (this.code - this.range) >>> 0;
				bit = 1;
			}
			result = ((result << 1) | bit) >>> 0;
			this.normalize();
		}
		return result;
	}

	bit(probs: Uint16Array, index: number) {
		const prob = probs[index];
		const bound = (this.range >>> 11) * prob;
		let bit: number;
		if (this.code < bound) {
			probs[index] = prob + ((2048 - prob) >>> 5);
			this.range = bound;
			bit = 0;
		} else {
			probs[index] = prob - (prob >>> 5);
			this.code = (this.code - bound) >>> 0;
			this.range = (this.range - bound) >>> 0;
			bit = 1;
		}
		this.normalize();
		return bit;
	}
}

const probs = (size: number) => new Uint16Array(size).fill(PROB_INIT);

function bitTree(rc: RangeDecoder, tree: Uint16Array, bits: number, offset = 0) {
	let m = 1;
	for (let i = 0; i < bits; i++) m = (m << 1) + rc.bit(tree, offset + m);
	return m - (1 << bits);
}

function reverseBitTree(rc: RangeDecoder, tree: Uint16Array, bits: number, offset = 0) {
	let m = 1;
	let symbol = 0;
	for (let i = 0; i < bits; i++) {
		const bit = rc.bit(tree, offset + m);
		m = (m << 1) + bit;
		symbol |= bit << i;
	}
	return symbol;
}

class LengthDecoder {
	private choice = probs(2);
	private low: Uint16Array;
	private mid: Uint16Array;
	private high = probs(256);

	constructor(posStates: number) {
		this.low = probs(posStates << 3);
		this.mid = probs(posStates << 3);
	}

	decode(rc: RangeDecoder, posState: number) {
		if (!rc.bit(this.choice, 0)) return bitTree(rc, this.low, 3, posState << 3);
		if (!rc.bit(this.choice, 1)) return 8 + bitTree(rc, this.mid, 3, posState << 3);
		return 16 + bitTree(rc, this.high, 8);
	}
}

/** Decompresses LZMA alone data; throws on broken data */
export function decompressLzma(data: Uint8Array): Uint8Array {
	if (data.length < 13) throw new Error('LZMA data too short');
	let d = data[0];
	if (d >= 9 * 5 * 5) throw new Error('Bad LZMA properties');
	const lc = d % 9;
	d = (d / 9) | 0;
	const lp = d % 5;
	const pb = (d / 5) | 0;
	let unpacked = 0;
	let known = false;
	for (let i = 0; i < 8; i++) {
		if (data[5 + i] !== 0xff) known = true;
	}
	if (known) {
		for (let i = 7; i >= 0; i--) unpacked = unpacked * 256 + data[5 + i];
	}

	const rc = new RangeDecoder(data, 13);
	let out = new Uint8Array(known ? unpacked : Math.max(1024, data.length * 8));
	let size = 0;
	const put = (byte: number) => {
		if (size >= out.length) {
			const bigger = new Uint8Array(out.length * 2);
			bigger.set(out);
			out = bigger;
		}
		out[size++] = byte;
	};

	const literals = probs(0x300 << (lc + lp));
	const posStates = 1 << pb;
	const isMatch = probs(12 << 4);
	const isRep = probs(12);
	const isRepG0 = probs(12);
	const isRepG1 = probs(12);
	const isRepG2 = probs(12);
	const isRep0Long = probs(12 << 4);
	const posSlot = probs(4 << 6);
	const posDecoders = probs(1 + 114);
	const align = probs(16);
	const lengths = new LengthDecoder(posStates);
	const repLengths = new LengthDecoder(posStates);

	let state = 0;
	let rep0 = 0;
	let rep1 = 0;
	let rep2 = 0;
	let rep3 = 0;

	const literal = () => {
		const previous = size > 0 ? out[size - 1] : 0;
		const litState = ((size & ((1 << lp) - 1)) << lc) + (previous >>> (8 - lc));
		const base = 0x300 * litState;
		let symbol = 1;
		if (state >= 7) {
			let match = out[size - rep0 - 1];
			do {
				const matchBit = (match >>> 7) & 1;
				match <<= 1;
				const bit = rc.bit(literals, base + ((1 + matchBit) << 8) + symbol);
				symbol = (symbol << 1) | bit;
				if (matchBit !== bit) break;
			} while (symbol < 0x100);
		}
		while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literals, base + symbol);
		put(symbol - 0x100);
	};

	const distance = (length: number) => {
		const lenState = Math.min(length, 3);
		const slot = bitTree(rc, posSlot, 6, lenState << 6);
		if (slot < 4) return slot;
		const bits = (slot >>> 1) - 1;
		let dist = ((2 | (slot & 1)) << bits) >>> 0;
		if (slot < 14) dist += reverseBitTree(rc, posDecoders, bits, dist - slot);
		else {
			dist += rc.direct(bits - 4) << 4;
			dist += reverseBitTree(rc, align, 4);
		}
		return dist >>> 0;
	};

	while (!known || size < unpacked) {
		const posState = size & (posStates - 1);
		if (!rc.bit(isMatch, (state << 4) + posState)) {
			literal();
			state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
			continue;
		}
		let length: number;
		if (rc.bit(isRep, state)) {
			if (size === 0) throw new Error('Broken LZMA data');
			if (!rc.bit(isRepG0, state)) {
				if (!rc.bit(isRep0Long, (state << 4) + posState)) {
					state = state < 7 ? 9 : 11;
					put(out[size - rep0 - 1]);
					continue;
				}
			} else {
				let dist: number;
				if (!rc.bit(isRepG1, state)) dist = rep1;
				else {
					if (!rc.bit(isRepG2, state)) dist = rep2;
					else {
						dist = rep3;
						rep3 = rep2;
					}
					rep2 = rep1;
				}
				rep1 = rep0;
				rep0 = dist;
			}
			length = repLengths.decode(rc, posState);
			state = state < 7 ? 8 : 11;
		} else {
			rep3 = rep2;
			rep2 = rep1;
			rep1 = rep0;
			length = lengths.decode(rc, posState);
			state = state < 7 ? 7 : 10;
			rep0 = distance(length);
			if (rep0 === 0xffffffff) break; // end marker
			if (rep0 >= size) throw new Error('Broken LZMA data');
		}
		length += 2;
		for (let i = 0; i < length && (!known || size < unpacked); i++) put(out[size - rep0 - 1]);
	}
	return out.subarray(0, size);
}
