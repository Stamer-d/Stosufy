<script>
	// The equalizer: on/off, presets and the ten bands as sliders
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { EQ_BANDS, EQ_LIMIT, EQ_PRESETS, DEFAULT_EQ } from '#lib/stores/equalizer.ts';

	let eq = $derived({ ...DEFAULT_EQ, ...$userSettings.settings?.equalizer });

	function save(change) {
		updateUserSettings({ equalizer: { ...eq, ...change } });
	}

	function setBand(index, value) {
		const gains = [...eq.gains];
		gains[index] = value;
		const preset = Object.entries(EQ_PRESETS).find(([, values]) =>
			values.every((v, i) => v === gains[i])
		)?.[0];
		save({ gains, preset: preset ?? null, on: true });
	}

	const label = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
	const db = (value) => (value > 0 ? `+${value}` : String(value));
</script>

<div class="rounded-xl bg-white/[0.03] ring-1 ring-white/5 p-4">
	<div class="flex items-center justify-between gap-4">
		<div>
			<p class="font-semibold text-white">Equalizer</p>
			<p class="text-sm text-secondary-600">
				{eq.on ? (eq.preset ?? 'Custom') : 'Off'} · shapes the sound of downloaded songs
			</p>
		</div>
		<button
			role="switch"
			aria-checked={eq.on}
			aria-label="Equalizer"
			class="relative w-11 h-6 rounded-full cursor-pointer transition {eq.on
				? 'bg-primary-500'
				: 'bg-secondary-300'}"
			onclick={() => save({ on: !eq.on })}
		>
			<span
				class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {eq.on
					? 'translate-x-5'
					: ''}"
			></span>
		</button>
	</div>

	<div class="mt-4 flex flex-wrap gap-1.5">
		{#each Object.entries(EQ_PRESETS) as [name, gains] (name)}
			<button
				class="h-7 px-3 rounded-full text-xs font-semibold cursor-pointer transition {eq.on &&
				eq.preset === name
					? 'bg-white text-black'
					: 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'}"
				onclick={() => save({ gains: [...gains], preset: name, on: true })}
			>
				{name}
			</button>
		{/each}
	</div>

	<div
		class="mt-5 grid grid-cols-10 gap-1 transition-opacity {eq.on ? '' : 'opacity-40'}"
		aria-label="Equalizer bands"
	>
		{#each EQ_BANDS as hz, i (hz)}
			<div class="flex flex-col items-center gap-2">
				<span class="text-[11px] tabular-nums text-white/60">{db(eq.gains[i] ?? 0)}</span>
				<input
					type="range"
					class="eq-slider"
					min={-EQ_LIMIT}
					max={EQ_LIMIT}
					step="0.5"
					value={eq.gains[i] ?? 0}
					aria-label="{label(hz)}Hz"
					oninput={(e) => setBand(i, Number(e.currentTarget.value))}
					ondblclick={() => setBand(i, 0)}
				/>
				<span class="text-[11px] font-semibold text-secondary-600">{label(hz)}</span>
			</div>
		{/each}
	</div>
	<p class="mt-3 text-xs text-secondary-600">Double-click a band to reset it.</p>
</div>

<style>
	.eq-slider {
		writing-mode: vertical-lr;
		direction: rtl;
		width: 1.25rem;
		height: 8rem;
		accent-color: var(--color-primary-500, #8b5cf6);
		cursor: pointer;
	}
</style>
