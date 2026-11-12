// Times as they're shown and typed: m:ss.s, h:mm:ss.s

/** m:ss.s (or h:mm:ss.s) */
export function clock(seconds: number) {
	const s = Math.max(0, seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const rest = (s % 60).toFixed(1).padStart(4, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A time typed as s, m:ss or h:mm:ss (with tenths), or null */
export function parseClock(text: string): number | null {
	const parts = text.trim().replace(',', '.').split(':');
	if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part)))
		return null;
	return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}
