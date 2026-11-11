// A deck's player in the AudioWorklet (deckProcessor.js), with the key lock: a song played
// faster or slower keeps its pitch (Signalsmith Stretch, MIT). The library's WebAssembly part
// and the processor run in the worklet as one module.

import stretchSource from 'signalsmith-stretch?raw';
import processorSource from './deckProcessor.js?raw';

/** A segment of a deck's timeline as the worklet takes it */
export interface WorkletSegment {
	/** Time of the audio clock it starts at */
	at: number;
	active: boolean;
	/** Where in the song it is then (s) */
	input: number;
	rate: number;
	loopStart: number;
	loopEnd: number;
	/** Through the stretcher (key lock), else read as it is */
	stretch: boolean;
}

export interface WorkletPlayer {
	node: AudioWorkletNode;
	/** Whether it can keep the pitch (the stretcher started) */
	keyLock: boolean;
	setBuffer(channels: Float32Array[]): Promise<void>;
	/** Replaces the timeline from the first segment's time on */
	schedule(segments: WorkletSegment[]): Promise<void>;
}

const modules = new WeakMap<BaseAudioContext, Promise<void>>();
let url: string | null = null;

function moduleUrl() {
	const marker = 'function registerWorkletProcessor(';
	const at = stretchSource.indexOf(marker);
	if (at < 0) throw new Error('Unknown Signalsmith Stretch build');
	const code = `${stretchSource.slice(0, at)}\nconst __stretchFactory = SignalsmithStretch;\n${processorSource}`;
	return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

/** A deck's player in the worklet (null where the web view can't run worklets) */
export async function createWorkletPlayer(ctx: BaseAudioContext): Promise<WorkletPlayer | null> {
	try {
		if (!ctx.audioWorklet) return null;
		url ??= moduleUrl();
		if (!modules.has(ctx)) modules.set(ctx, ctx.audioWorklet.addModule(url));
		await modules.get(ctx);
		const node = new AudioWorkletNode(ctx, 'stosufy-deck', {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			outputChannelCount: [2]
		});
		let id = 0;
		const waiting = new Map<number, () => void>();
		let ready: (keyLock: boolean) => void = () => {};
		const started = new Promise<boolean>((resolve) => (ready = resolve));
		node.port.onmessage = (event) => {
			const data = event.data;
			if (data.type === 'ready') {
				if (data.error) console.warn('No key lock in the DJ mode:', data.error);
				ready(!!data.keyLock);
			}
			if (data.type === 'ack') {
				waiting.get(data.id)?.();
				waiting.delete(data.id);
			}
		};
		const send = (message: object, transfer: Transferable[] = []) =>
			new Promise<void>((resolve) => {
				const n = id++;
				waiting.set(n, resolve);
				node.port.postMessage({ ...message, id: n }, transfer);
			});
		const keyLock = await Promise.race([
			started,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))
		]);
		if (keyLock == null) throw new Error('The deck player did not start');
		return {
			node,
			keyLock,
			setBuffer: (channels) =>
				send(
					{ type: 'buffer', channels },
					channels.map((c) => c.buffer)
				),
			schedule: (segments) => send({ type: 'timeline', segments })
		};
	} catch (error) {
		console.warn('The DJ decks play without the worklet:', error);
		return null;
	}
}
