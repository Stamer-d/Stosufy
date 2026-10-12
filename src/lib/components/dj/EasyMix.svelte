<script>
	// The middle of the easy DJ mode: how well the two songs fit, one big button that mixes
	// to the other deck the way that fits best, and the crossfader
	import { onMount } from 'svelte';
	import Fader from './Fader.svelte';
	import Knob from './Knob.svelte';
	import { TRANSITIONS } from '#lib/dj/engine.ts';

	let { mixer, state: mix, colors } = $props();

	let progress = $state(0);
	let waitBars = $state(0);

	onMount(() => {
		let frame;
		const loop = () => {
			const t = mixer.transition;
			const now = mixer.ctx.currentTime;
			progress = t ? Math.max(0, Math.min(1, (now - t.start) / (t.end - t.start))) : 0;
			waitBars = t && now < t.start ? Math.ceil((t.start - now) / (t.beat * 4)) : 0;
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	let lead = $derived(
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
	let target = $derived(lead === 'A' ? 'B' : lead === 'B' ? 'A' : null);
	let ready = $derived(!!target && mix[target].duration > 0 && !mix[target].loading);

	/** What the mix will do, from the engine's plan */
	let plan = $derived.by(() => {
		void mix.A.tempo;
		void mix.B.tempo;
		void mix.A.song;
		void mix.B.song;
		void mix.transitionType;
		if (!ready || !lead) return null;
		return mixer.plan(mixer.decks[lead], mixer.decks[target]);
	});

	const FIT = {
		perfect: {
			label: 'Perfect match',
			class: 'text-green-300 bg-green-400/15',
			tip: 'Same tempo: a long, smooth blend'
		},
		good: {
			label: 'Good match',
			class: 'text-lime-300 bg-lime-400/15',
			tip: 'A small tempo change, nobody will notice'
		},
		tricky: {
			label: 'Tempo ride',
			class: 'text-amber-300 bg-amber-400/15',
			tip: 'Tempos far apart: they meet in the middle, slowly, and the new song glides back after'
		},
		clash: {
			label: 'No beat to match',
			class: 'text-white/70 bg-white/10',
			tip: 'A song without a tempo: the old one echoes out'
		}
	};
	const typeName = (id) => TRANSITIONS.find((t) => t.id === id)?.name ?? id;
	const percent = (change) => `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
</script>

<section
	class="shrink-0 w-[19rem] flex flex-col items-center gap-3 p-4 rounded-2xl bg-white/[0.035] ring-1 ring-white/[0.06]"
>
	{#if plan}
		{@const fit = FIT[plan.fit.rating]}
		<div class="text-center" title={fit.tip}>
			<span class="px-3 py-1 rounded-full text-sm font-black {fit.class}">{fit.label}</span>
			<p class="mt-2 text-xs text-white/50">
				{#if plan.fit.change != null}
					{target} plays at {percent(plan.fit.change)} to match {lead}
				{:else}
					{fit.tip}
				{/if}
			</p>
		</div>
	{:else}
		<p class="text-center text-sm text-white/50 px-2 pt-2">
			{#if !mix.A.duration && !mix.B.duration}
				Drag a song onto a deck and press play
			{:else if !lead}
				Press play on a deck
			{:else}
				Put the next song on deck {target}
			{/if}
		</p>
	{/if}

	<!-- The big button -->
	{#if mix.transition}
		<button
			class="relative size-40 rounded-full grid place-items-center cursor-pointer"
			title="Stop the mix where it is"
			onclick={() => mixer.cancelMix()}
		>
			<svg viewBox="0 0 100 100" class="absolute inset-0 -rotate-90">
				<circle
					cx="50"
					cy="50"
					r="46"
					fill="none"
					stroke="rgba(255,255,255,0.1)"
					stroke-width="6"
				/>
				<circle
					cx="50"
					cy="50"
					r="46"
					fill="none"
					stroke={colors[mix.transition.to]}
					stroke-width="6"
					stroke-linecap="round"
					stroke-dasharray="{progress * 289} 289"
				/>
			</svg>
			<span class="text-center">
				<span class="block text-2xl font-black">
					{waitBars ? `in ${waitBars}` : `${Math.round(progress * 100)}%`}
				</span>
				<span class="block text-xs text-white/60">
					{waitBars ? (waitBars === 1 ? 'bar' : 'bars') : typeName(mix.transition.type)}
				</span>
				<span class="block mt-1 text-[10px] font-bold text-white/40">TAP TO STOP</span>
			</span>
		</button>
	{:else}
		<button
			disabled={!ready}
			title={ready ? `Mix from ${lead} to ${target}` : 'Play one deck and load a song on the other'}
			class="size-40 rounded-full grid place-items-center text-black font-black cursor-pointer transition shadow-2xl disabled:cursor-default disabled:opacity-30 disabled:shadow-none hover:scale-[1.03] active:scale-95"
			style="background: {target
				? `radial-gradient(circle at 30% 30%, white, ${colors[target]} 65%)`
				: 'rgba(255,255,255,0.2)'}"
			onclick={() => mixer.mix()}
		>
			<span class="text-center">
				<span class="icon-[mingcute--magic-2-fill] size-8 block mx-auto"></span>
				<span class="block text-xl">MIX</span>
				<span class="block text-xs font-bold opacity-70"
					>{lead && target ? `${lead} → ${target}` : ''}</span
				>
			</span>
		</button>
	{/if}

	{#if plan && !mix.transition}
		<p class="text-xs text-center text-white/60 leading-relaxed">
			<b class="text-white/90">{typeName(plan.type)}</b>
			{plan.type === 'cut' ? 'on the next bar' : `over ${plan.bars} bars`}{plan.inPoint !==
			(mix[target]?.hotCues?.[0] ?? mix[target]?.cue)
				? ', the new song lands on its drop'
				: ''}
		</p>
	{/if}

	<div class="flex flex-wrap justify-center gap-1">
		{#each TRANSITIONS as transition (transition.id)}
			<button
				title={transition.description}
				aria-pressed={mix.transitionType === transition.id}
				class="h-7 px-2 rounded-full text-[11px] font-bold cursor-pointer ring-1 transition {mix.transitionType ===
				transition.id
					? 'bg-white text-black ring-white'
					: 'bg-white/[0.06] ring-white/10 text-white/60 hover:text-white'}"
				onclick={() =>
					mixer.setTransition(transition.id, transition.id === 'smart' ? 16 : mix.transitionBars)}
				>{transition.name}</button
			>
		{/each}
	</div>

	<div class="flex gap-3 text-xs text-white/70">
		<label
			class="flex items-center gap-1.5 cursor-pointer"
			title="A rising sweep and some reverb in the mix"
		>
			<input
				type="checkbox"
				checked={mix.hype}
				onchange={(e) => mixer.setOptions({ hype: e.currentTarget.checked })}
				class="accent-violet-400"
			/>
			Riser FX
		</label>
		<label
			class="flex items-center gap-1.5 cursor-pointer"
			title="After a mix, the new song slowly goes back to its own tempo"
		>
			<input
				type="checkbox"
				checked={mix.glide}
				onchange={(e) => mixer.setOptions({ glide: e.currentTarget.checked })}
				class="accent-violet-400"
			/>
			Back to own tempo
		</label>
	</div>

	<div class="mt-auto w-full flex items-center gap-2">
		<span class="text-xs font-black" style="color: {colors.A}">A</span>
		<Fader
			vertical={false}
			value={mix.crossfader}
			min={0}
			max={1}
			center={0.5}
			length={200}
			label="Crossfader"
			onchange={(v) => mixer.setCrossfader(v)}
		/>
		<span class="text-xs font-black" style="color: {colors.B}">B</span>
		<Knob
			label="Vol"
			value={mix.master}
			min={0}
			max={1.5}
			center={0.85}
			size={34}
			color="white"
			format={(v) => `${Math.round(v * 100)}%`}
			onchange={(v) => mixer.setMaster(v)}
		/>
	</div>
</section>
