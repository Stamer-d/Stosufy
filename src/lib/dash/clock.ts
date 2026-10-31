// The song's time for the Dash mode: smooth between the audio element's updates. The element's
// time comes in steps (and its latency wobbles), so the clock runs on its own and only drifts
// towards it, never backwards, unless the song really jumped. The audio delay (the sound
// settings) holds the game back by how much later the music reaches the ears than the
// element says (Bluetooth headphones, some drivers).

export class SongClock {
	/** How much later the song is heard than its time says (ms) */
	delay = 0;
	private lastRaw = -1;
	private lastNow = 0;
	private shown = 0;
	private shownAt = 0;

	/**
	 * The song time (ms) now: from the audio's time (`raw`, ms), the page's clock (`now`, ms),
	 * whether it's paused and how fast it plays
	 */
	read(raw: number, now: number, paused: boolean, rate = 1) {
		raw -= this.delay;
		if (paused || this.lastRaw < 0) {
			this.lastRaw = raw;
			this.lastNow = this.shownAt = now;
			return (this.shown = raw);
		}
		if (raw !== this.lastRaw) {
			this.lastRaw = raw;
			this.lastNow = now;
		}
		const heard = raw + Math.min(120, (now - this.lastNow) * rate);
		const ahead = this.shown + (now - this.shownAt) * rate;
		const off = heard - ahead;
		const pull = 1 - Math.exp(-(now - this.shownAt) / 250);
		this.shown = Math.abs(off) > 60 ? heard : Math.max(this.shown, ahead + off * pull);
		this.shownAt = now;
		return this.shown;
	}

	/**
	 * The song time of something that happened at `at` (the page's clock, ms; an input event's
	 * time stamp), not when it's handled: the page may have been busy drawing in between
	 */
	at(at: number, raw: number, now: number, paused: boolean, rate = 1) {
		const time = this.read(raw, now, paused, rate);
		const late = now - at;
		return late > 0 && late < 100 ? time - late * rate : time;
	}

	/** The song jumped (a seek): the next time read is taken as it is */
	jumped() {
		this.lastRaw = -1;
	}
}
