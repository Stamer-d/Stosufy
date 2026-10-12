<script>
	// The mixer: gain, EQ with kills and the filter per channel, meters, channel faders, the
	// crossfader and the master; and the automatic mix with its kind and length
	import { onMount } from 'svelte';
	import Knob from './Knob.svelte';
	import Fader from './Fader.svelte';
	import { EQ_MIN, EQ_MAX, TRANSITIONS } from '#lib/dj/engine.ts';

	let { mixer, state: mix, colors } = $props();

	let meters = $state({ A: 0, B: 0, master: 0 });
	let progress = $state(0);

	onMount(() => {
		let frame;
		const loop = () => {
			const db = (v) => Math.max(0, Math.min(1, (20 * Math.log10(v || 1e-6) + 48) / 48));
			meters = {
				A: db(mixer.decks.A.level()),
				B: db(mixer.decks.B.level()),
				master: db(mixer.level())
			};
			const t = mixer.transition;
			progress = t
				? Math.max(0, Math.min(1, (mixer.ctx.currentTime - t.start) / (t.end - t.start)))
				: 0;
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	const dbText = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
	const filterText = (v) =>
		v === 0 ? 'Off' : v < 0 ? `LP ${Math.round(-v * 100)}%` : `HP ${Math.round(v * 100)}%`;
	const BARS = [4, 8, 16, 32];

	let leading = $derived(
		mix.A.playing && !mix.B.playing
			? 'A'
			: mix.B.playing && !mix.A.playing
				? 'B'
				: mix.A.playing && mix.B.playing
					? mix.crossfader <= 0.5
						? 'A'
						: 'B'
					: null
	);
	let target = $derived(leading === 'A' ? 'B' : leading === 'B' ? 'A' : null);
	let canMix = $derived(
		!!target && !!mix[target]?.song && !mix[target]?.loading && !mix.transition
	);
</script>

{#snippet meter(level, color)}
	<div class="relative w-2 h-[150px] rounded-sm bg-black/50 overflow-hidden">
		<div
			class="absolute bottom-0 inset-x-0 transition-[height] duration-75"
			style="height: {level *
				100}%; background: linear-gradient(to top, {color} 0%, {color} 65%, #facc15 85%, #ef4444 100%)"
		></div>
	</div>
{/snippet}

{#snippet channel(id)}
	{@const s = mix[id]}
	{@const deck = mixer.decks[id]}
	<div class="flex flex-col items-center gap-1.5">
		<Knob
			label="Gain"
			value={s.gain}
			min={-12}
			max={12}
			center={0}
			size={38}
			color={colors[id]}
			format={dbText}
			onchange={(v) => deck.set({ gain: v })}
		/>
		{#each [['high', 'Hi'], ['mid', 'Mid'], ['low', 'Low']] as [band, name] (band)}
			<div class="flex items-center gap-1">
				<Knob
					label={name}
					value={s.eq[band]}
					min={EQ_MIN}
					max={EQ_MAX}
					center={0}
					size={38}
					color={colors[id]}
					format={dbText}
					onchange={(v) => deck.set({ eq: { ...s.eq, [band]: v } })}
				/>
				<button
					title="Kill the {name.toLowerCase()}s"
					aria-label="Kill {name}"
					aria-pressed={s.kill[band]}
					class="w-5 h-5 rounded text-[9px] font-black cursor-pointer ring-1 transition {s.kill[
						band
					]
						? 'bg-red-500 ring-red-300 text-white'
						: 'bg-white/[0.06] ring-white/10 text-white/50 hover:text-white'}"
					onclick={() => deck.set({ kill: { ...s.kill, [band]: !s.kill[band] } })}>K</button
				>
			</div>
		{/each}
		<Knob
			label="Filter"
			value={s.filter}
			min={-1}
			max={1}
			center={0}
			size={38}
			color="#e879f9"
			format={filterText}
			onchange={(v) => deck.set({ filter: v })}
		/>
	</div>
{/snippet}

<section
	class="shrink-0 flex flex-col gap-3 p-3 rounded-xl bg-white/[0.035] ring-1 ring-white/[0.06]"
>
	<div class="flex items-start gap-3">
		{@render channel('A')}
		<div class="flex items-end gap-2 pt-2">
			<div class="flex flex-col items-center gap-1">
				<Fader
					value={mix.A.volume}
					min={0}
					max={1}
					center={1}
					length={150}
					label="Volume A"
					onchange={(v) => mixer.decks.A.set({ volume: v })}
				/>
				<span class="text-[10px] font-black" style="color: {colors.A}">A</span>
			</div>
			{@render meter(meters.A, colors.A)}
			<div class="flex flex-col items-center gap-2">
				<Knob
					label="Master"
					value={mix.master}
					min={0}
					max={1.5}
					center={0.85}
					size={38}
					color="white"
					format={(v) => `${Math.round(v * 100)}%`}
					onchange={(v) => mixer.setMaster(v)}
				/>
				{@render meter(meters.master, '#a3e635')}
			</div>
			{@render meter(meters.B, colors.B)}
			<div class="flex flex-col items-center gap-1">
				<Fader
					value={mix.B.volume}
					min={0}
					max={1}
					center={1}
					length={150}
					label="Volume B"
					onchange={(v) => mixer.decks.B.set({ volume: v })}
				/>
				<span class="text-[10px] font-black" style="color: {colors.B}">B</span>
			</div>
		</div>
		{@render channel('B')}
	</div>

	<div class="flex items-center justify-center gap-2">
		<span class="text-xs font-black" style="color: {colors.A}">A</span>
		<Fader
			vertical={false}
			value={mix.crossfader}
			min={0}
			max={1}
			center={0.5}
			length={220}
			label="Crossfader"
			onchange={(v) => mixer.setCrossfader(v)}
		/>
		<span class="text-xs font-black" style="color: {colors.B}">B</span>
	</div>

	<!-- The automatic mix -->
	<div class="flex flex-col gap-2 pt-2 border-t border-white/10">
		<!-- In a grid as wide as the mixer above (w-0 min-w-full: the buttons don't widen it) -->
		<div class="grid grid-cols-3 gap-1 w-0 min-w-full">
			{#each TRANSITIONS as transition (transition.id)}
				<button
					title={transition.description}
					aria-pressed={mix.transitionType === transition.id}
					class="h-7 px-1.5 truncate rounded-md text-[11px] font-bold cursor-pointer ring-1 transition {mix.transitionType ===
					transition.id
						? 'bg-white text-black ring-white'
						: 'bg-white/[0.06] ring-white/10 text-white/70 hover:text-white'}"
					onclick={() => mixer.setTransition(transition.id, mix.transitionBars)}
					>{transition.name}</button
				>
			{/each}
		</div>
		<div class="flex items-center gap-1 w-0 min-w-full">
			<span class="text-[10px] font-bold text-white/40 mr-1">BARS</span>
			{#each BARS as bars (bars)}
				<button
					aria-pressed={mix.transitionBars === bars}
					disabled={mix.transitionType === 'cut'}
					class="h-7 min-w-8 px-1.5 rounded-md text-[11px] font-bold cursor-pointer ring-1 transition disabled:opacity-30 {mix.transitionBars ===
					bars
						? 'bg-white text-black ring-white'
						: 'bg-white/[0.06] ring-white/10 text-white/70 hover:text-white'}"
					onclick={() => mixer.setTransition(mix.transitionType, bars)}>{bars}</button
				>
			{/each}
			{#if mix.transition}
				<button
					class="ml-auto relative h-8 px-3 rounded-md text-xs font-black bg-red-500/80 hover:bg-red-500 cursor-pointer overflow-hidden"
					onclick={() => mixer.cancelMix()}
				>
					<span class="absolute inset-y-0 left-0 bg-white/25" style="width: {progress * 100}%"
					></span>
					<span class="relative">STOP MIX {mix.transition.from}→{mix.transition.to}</span>
				</button>
			{:else}
				<button
					title={canMix
						? `Mix from ${leading} to ${target} on the next bar`
						: 'Play one deck and load a song on the other'}
					disabled={!canMix}
					class="ml-auto h-8 px-3 rounded-md text-xs font-black cursor-pointer transition disabled:opacity-40 disabled:cursor-default text-black"
					style="background: {target ? colors[target] : 'white'}"
					onclick={() => mixer.mix()}
				>
					MIX {leading && target ? `${leading} → ${target}` : ''}
				</button>
			{/if}
		</div>
	</div>
</section>
