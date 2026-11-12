// A video's pictures along its timeline: taken from a video of its own (not the one that plays),
// one at a time, those in view first, kept for when they're in view again (zoomed in or out).

/** How high they're taken (px; shown at half of it, sharp on a high-density screen) */
const TAKEN = 96;
/** Kept at most (the oldest let go first) */
const KEPT = 400;

export interface Thumbnails {
	/** Width to height of the video's picture */
	readonly aspect: number;
	/** Goes up with each picture taken (to draw again) */
	readonly version: number;
	/** These wanted now (any others still to take are dropped) */
	want(times: number[]): void;
	/** The picture at that time, else the nearest one taken (null: none yet) */
	get(time: number): HTMLCanvasElement | null;
	destroy(): void;
}

const keyOf = (time: number) => Math.round(time * 1000);

export function createThumbnails(url: string): Thumbnails {
	const video = document.createElement('video');
	video.muted = true;
	video.preload = 'auto';
	video.playsInline = true;
	video.src = url;
	const taken = new Map<number, HTMLCanvasElement>();
	const state = $state({ aspect: 16 / 9, version: 0, ready: false });
	let queue: number[] = [];
	let busy = false;
	let gone = false;

	video.addEventListener(
		'loadedmetadata',
		() => {
			if (video.videoWidth && video.videoHeight)
				state.aspect = video.videoWidth / video.videoHeight;
			state.ready = true;
			void pump();
		},
		{ once: true }
	);

	/** There, and its picture ready (or given up on after a while) */
	function seek(time: number) {
		return new Promise<boolean>((resolve) => {
			const done = (ok: boolean) => {
				clearTimeout(timer);
				video.removeEventListener('seeked', seeked);
				resolve(ok);
			};
			const seeked = () => done(true);
			const timer = setTimeout(() => done(false), 4000);
			video.addEventListener('seeked', seeked);
			video.currentTime = time;
		});
	}

	async function pump() {
		if (busy || !state.ready) return;
		busy = true;
		while (queue.length && !gone) {
			const time = queue.shift()!;
			if (taken.has(keyOf(time))) continue;
			if (!(await seek(time)) || gone) continue;
			const canvas = document.createElement('canvas');
			canvas.height = TAKEN;
			canvas.width = Math.max(1, Math.round(TAKEN * state.aspect));
			try {
				canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
			} catch {
				continue;
			}
			taken.set(keyOf(time), canvas);
			if (taken.size > KEPT) taken.delete(taken.keys().next().value!);
			state.version++;
		}
		busy = false;
	}

	return {
		get aspect() {
			return state.aspect;
		},
		get version() {
			return state.version;
		},
		want(times) {
			queue = times.filter((time) => !taken.has(keyOf(time)));
			void pump();
		},
		get(time) {
			const exact = taken.get(keyOf(time));
			if (exact) return exact;
			let best: HTMLCanvasElement | null = null;
			let distance = Infinity;
			for (const [key, canvas] of taken) {
				const away = Math.abs(key - time * 1000);
				if (away < distance) {
					distance = away;
					best = canvas;
				}
			}
			return best;
		},
		destroy() {
			gone = true;
			queue = [];
			video.removeAttribute('src');
			video.load();
		}
	};
}
