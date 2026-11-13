<script>
	// A time typed as hours, minutes and seconds, each a field of its own (hours where the file is
	// an hour long or more, tenths only where it's shorter than a minute): two digits and on to the
	// next, arrows up and down count, a whole time can be pasted in ("1:34:50", "13450"), and
	// what's typed counts once a field is full, left, or Enter is pressed.
	import { parseClock } from './waveform.ts';

	/**
	 * @type {{
	 *   value: number,
	 *   duration: number,
	 *   label: string,
	 *   onset: (seconds: number) => void
	 * }}
	 */
	let { value, duration, label, onset } = $props();

	let withHours = $derived(duration >= 3600);
	let withTenths = $derived(duration < 60);

	/** @typedef {'h' | 'm' | 's' | 't'} Unit */
	/** @type {Record<Unit, { name: string, digits: number, max: number, seconds: number }>} */
	const UNITS = {
		h: { name: 'hours', digits: 2, max: 99, seconds: 3600 },
		m: { name: 'minutes', digits: 2, max: 59, seconds: 60 },
		s: { name: 'seconds', digits: 2, max: 59, seconds: 1 },
		t: { name: 'tenths', digits: 1, max: 9, seconds: 0.1 }
	};
	let units = $derived(
		/** @type {Unit[]} */ ([...(withHours ? ['h'] : []), 'm', 's', ...(withTenths ? ['t'] : [])])
	);

	/** The parts of a time, as shown */
	function partsOf(seconds) {
		const tenths = Math.round(Math.max(0, seconds) * (withTenths ? 10 : 1));
		const whole = withTenths ? Math.floor(tenths / 10) : tenths;
		const h = withHours ? Math.floor(whole / 3600) : 0;
		const m = Math.floor((whole - h * 3600) / 60);
		const s = whole % 60;
		return {
			h: String(h),
			m: String(m).padStart(withHours ? 2 : 1, '0'),
			s: String(s).padStart(2, '0'),
			t: String(withTenths ? tenths % 10 : 0)
		};
	}

	let text = $state(partsOf(0));
	/** The field being typed in (not overwritten from outside meanwhile) */
	let editing = $state(/** @type {Unit | null} */ (null));
	/** @type {Partial<Record<Unit, HTMLInputElement>>} */
	const fields = {};

	// (from outside: the time set elsewhere shown, but not in the field typed in)
	$effect(() => {
		const parts = partsOf(value);
		for (const unit of /** @type {Unit[]} */ (['h', 'm', 's', 't']))
			if (unit !== editing) text[unit] = parts[unit];
	});

	/** The time the fields say */
	function total() {
		return units.reduce((sum, unit) => {
			const n = Math.min(UNITS[unit].max, Number(text[unit]) || 0);
			return sum + n * UNITS[unit].seconds;
		}, 0);
	}

	function commit() {
		const seconds = Math.round(total() * 10) / 10;
		if (Math.abs(seconds - value) > 1e-6) onset(seconds);
		// (shown as it is now, tidied: 7 → 07)
		show();
	}

	/** The fields not typed in show the time as it is now, tidied (7 → 07) */
	function show() {
		const parts = partsOf(value);
		for (const unit of units) {
			if (unit === editing) continue;
			text[unit] = parts[unit];
			// (also where the field still holds what was typed, and the time is the same)
			const field = fields[unit];
			if (field && field.value !== parts[unit]) field.value = parts[unit];
		}
	}

	function focusAt(index) {
		const unit = units[index];
		const field = unit && fields[unit];
		if (!field) return false;
		field.focus();
		field.select();
		return true;
	}

	/** @param {Unit} unit */
	function typed(unit, event) {
		const field = event.currentTarget;
		const digits = field.value.replace(/\D/g, '').slice(0, UNITS[unit].digits);
		field.value = digits;
		text[unit] = digits;
		if (digits.length >= UNITS[unit].digits) {
			editing = null;
			commit();
			focusAt(units.indexOf(unit) + 1);
		}
	}

	/** @param {Unit} unit */
	function keydown(unit, event) {
		const index = units.indexOf(unit);
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const by = UNITS[unit].seconds * (event.key === 'ArrowUp' ? 1 : -1);
			onset(Math.min(duration, Math.max(0, Math.round((value + by) * 10) / 10)));
			editing = null;
			show();
			editing = unit;
			requestAnimationFrame(() => event.target.select?.());
		} else if (event.key === 'Enter') {
			event.preventDefault();
			editing = null;
			commit();
			event.currentTarget.blur();
		} else if ([':', '.', ',', ' '].includes(event.key)) {
			event.preventDefault();
			editing = null;
			commit();
			focusAt(index + 1);
		} else if (event.key === 'Backspace' && !event.currentTarget.value) {
			event.preventDefault();
			focusAt(index - 1);
		} else if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0) {
			if (focusAt(index - 1)) event.preventDefault();
		} else if (
			event.key === 'ArrowRight' &&
			event.currentTarget.selectionEnd === event.currentTarget.value.length
		) {
			if (focusAt(index + 1)) event.preventDefault();
		}
	}

	/** A whole time pasted in: "1:34:50", "94:50", "13450" (hh mm ss from the right) */
	function pasted(event) {
		const raw = event.clipboardData?.getData('text') ?? '';
		let seconds = parseClock(raw);
		if (seconds === null && /^\d{3,6}$/.test(raw.trim())) {
			const digits = raw.trim().padStart(6, '0');
			seconds =
				Number(digits.slice(0, 2)) * 3600 +
				Number(digits.slice(2, 4)) * 60 +
				Number(digits.slice(4));
		}
		if (seconds === null || (!/[:.,]/.test(raw) && raw.trim().length <= 2)) return;
		event.preventDefault();
		editing = null;
		onset(Math.min(duration, Math.max(0, seconds)));
	}

	/** Left for something outside the fields: what's typed counts */
	function focusout(event) {
		if (event.currentTarget.contains(event.relatedTarget)) return;
		editing = null;
		commit();
	}
</script>

<div
	class="flex items-center tabular-nums font-semibold"
	role="group"
	aria-label="{label} time"
	onfocusout={focusout}
>
	{#each units as unit, i (unit)}
		{#if i > 0}<span class="text-white/40 select-none">{unit === 't' ? '.' : ':'}</span>{/if}
		<input
			bind:this={fields[unit]}
			class="{UNITS[unit].digits === 1
				? 'w-[1.4ch]'
				: 'w-[2.6ch]'} h-8 bg-transparent text-center outline-none rounded-md focus:bg-white/10"
			inputmode="numeric"
			autocomplete="off"
			aria-label="{label} {UNITS[unit].name}"
			value={text[unit]}
			onfocus={(event) => {
				editing = unit;
				event.currentTarget.select();
			}}
			oninput={(event) => typed(unit, event)}
			onkeydown={(event) => keydown(unit, event)}
			onpaste={pasted}
		/>
	{/each}
</div>
