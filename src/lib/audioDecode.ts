// Audio every platform can play. The app runs in the system's web view: WebView2 (Chromium)
// on Windows, WebKit on macOS and Linux. Safari's WebKit can't decode Ogg Vorbis, which many
// beatmaps use, so there it's decoded here instead (in a worker, with a WebAssembly decoder).

/** Whether the bytes are an Ogg file ("OggS") */
export const isOgg = (bytes: Uint8Array) =>
	bytes.length > 4 &&
	bytes[0] === 0x4f &&
	bytes[1] === 0x67 &&
	bytes[2] === 0x67 &&
	bytes[3] === 0x53;

let oggPlayable: boolean | null = null;
/** Whether the web view plays Ogg Vorbis itself */
export function canPlayOgg() {
	oggPlayable ??= !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"');
	return oggPlayable;
}

async function decodeOgg(bytes: Uint8Array) {
	const { OggVorbisDecoderWebWorker } = await import('@wasm-audio-decoders/ogg-vorbis');
	const decoder = new OggVorbisDecoderWebWorker();
	try {
		await decoder.ready;
		const { channelData, sampleRate, samplesDecoded } = await decoder.decodeFile(bytes);
		if (!samplesDecoded || !channelData.length) throw new Error('Not an Ogg Vorbis file');
		return { channelData, sampleRate };
	} finally {
		decoder.free();
	}
}

/** Decodes audio for the Web Audio API, Ogg Vorbis too where the web view can't */
export async function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
	const bytes = new Uint8Array(data.slice(0));
	try {
		// (decodeAudioData takes the buffer over: a copy)
		return await ctx.decodeAudioData(data.slice(0));
	} catch (error) {
		if (!isOgg(bytes)) throw error;
		const { channelData, sampleRate } = await decodeOgg(bytes);
		const buffer = ctx.createBuffer(channelData.length, channelData[0].length, sampleRate);
		channelData.forEach((channel, i) =>
			buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i)
		);
		return buffer;
	}
}

/** 16-bit PCM WAV of decoded audio */
function wav(channels: Float32Array[], sampleRate: number) {
	const count = channels.length;
	const length = channels[0].length;
	const data = new DataView(new ArrayBuffer(44 + length * count * 2));
	const text = (at: number, value: string) =>
		[...value].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
	text(0, 'RIFF');
	data.setUint32(4, 36 + length * count * 2, true);
	text(8, 'WAVEfmt ');
	data.setUint32(16, 16, true);
	data.setUint16(20, 1, true);
	data.setUint16(22, count, true);
	data.setUint32(24, sampleRate, true);
	data.setUint32(28, sampleRate * count * 2, true);
	data.setUint16(32, count * 2, true);
	data.setUint16(34, 16, true);
	text(36, 'data');
	data.setUint32(40, length * count * 2, true);
	let at = 44;
	for (let i = 0; i < length; i++)
		for (let c = 0; c < count; c++) {
			const v = Math.max(-1, Math.min(1, channels[c][i]));
			data.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
			at += 2;
		}
	return new Uint8Array(data.buffer);
}

/** Bytes an audio element can play: Ogg turned into WAV where the web view can't play it */
export async function playableBytes(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
	const own = bytes as Uint8Array<ArrayBuffer>;
	if (!isOgg(bytes) || canPlayOgg()) return own;
	try {
		const { channelData, sampleRate } = await decodeOgg(bytes);
		return wav(channelData, sampleRate);
	} catch {
		return own;
	}
}
