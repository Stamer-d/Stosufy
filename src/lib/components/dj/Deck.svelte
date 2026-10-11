<script>
	// One deck: the song, a jog wheel, play / cue / sync, the tempo fader, hot cues, loops,
	// beat jumps and its effects
	import { onMount } from 'svelte';
	import SongCover from '../SongCover.svelte';
	import Knob from './Knob.svelte';
	import Fader from './Fader.svelte';
	import Overview from './Overview.svelte';
	import { TEMPO_RANGES, HOT_CUES } from '#lib/dj/engine.ts';

	let { deck, other, state: ds, color, side = 'left' } = $props();

	const HOT_COLORS = [
		'#ef4444',
		'#f97316',
		'#eab308',
		'#22c55e',
		'#06b6d4',
		'#3b82f6',
		'#a855f7',
		'#ec4899'
	];
	const LOOPS = [0.5, 1, 2, 4, 8, 16];

	let elapsed = $state('0:00.0');
	let remaining = $state('-0:00');
	let bpm = $state('---.-');
	let platter = $state();

	const time = (s, tenths = false) => {
		const sign = s < 0 ? '-' : '';
		s = Math.abs(s);
		const m = Math.floor(s / 60);
		const sec = s - m * 60;
		return `${sign}${m}:${(tenths ? sec.toFixed(1) : Math.floor(sec).toString()).padStart(tenths ? 4 : 2, '0')}`;
	};

	onMount(() => {
		let frame;
		const loop = () => {
			const pos = deck.position();
			elapsed = time(Math.max(0, pos), true);
			remaining = '-' + time(Math.max(0, deck.state.duration - pos));
			bpm = deck.buffer ? deck.bpm(pos).toFixed(1) : '---.-';
			// 33⅓ rpm: one turn is 1.8 seconds of the song
			if (platter) platter.style.transform = `rotate(${(pos / 1.8) * 360}deg)`;
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	// The jog wheel: turning it pushes the song along (playing) or moves through it (paused)
	let jog = null;
	function jogDown(event) {
		if (!deck.buffer) return;
		const rect = event.currentTarget.getBoundingClientRect();
		jog = {
			cx: rect.left + rect.width / 2,
			cy: rect.top + rect.height / 2,
			angle: null,
			time: performance.now()
		};
		jog.angle = Math.atan2(event.clientY - jog.cy, event.clientX - jog.cx);
		event.currentTarget.setPointerCapture(event.pointerId);
	}
	function jogMove(event) {
		if (!jog) return;
		const angle = Math.atan2(event.clientY - jog.cy, event.clientX - jog.cx);
		let delta = angle - jog.angle;
		if (delta > Math.PI) delta -= 2 * Math.PI;
		if (delta < -Math.PI) delta += 2 * Math.PI;
		jog.angle = angle;
		const seconds = (delta / (2 * Math.PI)) * 1.8;
		if (deck.state.playing) {
			const dt = Math.max(1, performance.now() - jog.time) / 1000;
			deck.setBend(Math.max(-0.4, Math.min(0.4, seconds / dt / 3)));
		} else deck.seek(deck.position() + seconds);
		jog.time = performance.now();
	}
	function jogUp() {
		if (jog && deck.state.playing) deck.setBend(0);
		jog = null;
	}

	const tempoText = (t) => `${t >= 0 ? '+' : ''}${(t * 100).toFixed(1)}%`;
	const loopText = (b) => (b < 1 ? '½' : String(b));
	/** (the deck's buffer isn't reactive; its state is) */
	const loaded = $derived(ds.duration > 0);
	const canSync = $derived(loaded && other?.state?.duration > 0);
</script>

{#snippet button(
	label,
	onclick,
	{ active = false, wide = false, title = '', tone = 'neutral' } = {}
)}
	<button
		{title}
		aria-label={title || label}
		aria-pressed={active}
		class="h-8 {wide
			? 'px-3'
			: 'min-w-8 px-1.5'} rounded-md text-xs font-bold cursor-pointer transition ring-1 {active
			? tone === 'green'
				? 'bg-green-500/80 ring-green-300 text-black'
				: 'bg-white text-black ring-white'
			: 'bg-white/[0.06] ring-white/10 text-white/80 hover:bg-white/15'}"
		{onclick}
	>
		{label}
	</button>
{/snippet}

<section
	class="flex-1 min-w-0 flex flex-col gap-3 p-3 rounded-xl bg-white/[0.035] ring-1 ring-white/[0.06]"
	style="--deck: {color}"
>
	<!-- The song -->
	<div
		class="flex items-center gap-3 min-w-0 {side === 'right' ? 'flex-row-reverse text-right' : ''}"
	>
		<span
			class="shrink-0 size-8 grid place-items-center rounded-md text-sm font-black text-black"
			style="background: {color}">{deck.id}</span
		>
		<div class="min-w-0 flex-1">
			{#if ds.song}
				<p class="font-bold truncate">{ds.song.title}</p>
				<p class="text-xs text-white/50 truncate">
					{ds.song.artist}{ds.error ? '' : ds.loading ? ' · loading…' : ''}
				</p>
				{#if ds.error}<p class="text-xs text-red-400 truncate">{ds.error}</p>{/if}
			{:else}
				<p class="text-sm text-white/40">Load a song from the list below</p>
			{/if}
		</div>
		<div class="shrink-0 {side === 'right' ? 'text-left' : 'text-right'}">
			<p class="text-xl font-black tabular-nums leading-none" style="color: {color}">{bpm}</p>
			<p class="text-[10px] font-bold text-white/40 tracking-wide">
				BPM {ds.tempo ? tempoText(ds.tempo) : ''}
			</p>
		</div>
	</div>

	<Overview {deck} {color} />
	<div class="flex justify-between text-xs font-semibold tabular-nums text-white/60 -mt-1">
		<span>{elapsed}</span>
		<span>{remaining}</span>
	</div>

	<div class="flex gap-3 {side === 'right' ? 'flex-row-reverse' : ''}">
		<!-- Jog wheel and transport -->
		<div class="flex flex-col items-center gap-3">
			<div
				class="relative size-36 rounded-full bg-gradient-to-b from-zinc-700 to-zinc-900 ring-2 ring-black shadow-xl shadow-black/60 cursor-grab active:cursor-grabbing touch-none select-none"
				role="slider"
				aria-label="Jog wheel"
				aria-valuenow={0}
				tabindex="-1"
				onpointerdown={jogDown}
				onpointermove={jogMove}
				onpointerup={jogUp}
				onpointercancel={jogUp}
			>
				<div
					bind:this={platter}
					class="absolute inset-2 rounded-full overflow-hidden ring-1 ring-white/10"
				>
					{#if ds.song}
						<SongCover setId={ds.song.id} title={ds.song.title} class="size-full opacity-80" />
					{/if}
					<div
						class="absolute left-1/2 top-1 -translate-x-1/2 w-1 h-6 rounded-full bg-white/90"
					></div>
				</div>
				<div
					class="absolute inset-[42%] rounded-full bg-zinc-900 ring-2"
					style="--tw-ring-color: {ds.playing ? color : 'rgba(255,255,255,0.15)'}"
				></div>
			</div>
			<div class="flex gap-2">
				<button
					title="Cue: back to the cue point (playing), set it (paused), hold to listen"
					aria-label="Cue"
					class="size-12 rounded-full text-xs font-black ring-2 cursor-pointer transition bg-black/40 ring-amber-400/70 text-amber-300 hover:bg-amber-400/15"
					onpointerdown={() => deck.cueDown()}
					onpointerup={() => deck.cueUp()}
					onpointerleave={() => deck.cueUp()}>CUE</button
				>
				<button
					title={ds.playing ? 'Pause' : 'Play'}
					aria-label={ds.playing ? 'Pause' : 'Play'}
					disabled={!loaded}
					class="size-12 grid place-items-center rounded-full ring-2 cursor-pointer transition bg-black/40 disabled:opacity-40 {ds.playing
						? 'ring-green-400 text-green-300'
						: 'ring-white/30 text-white hover:bg-white/10'}"
					onclick={() => deck.toggle()}
				>
					<span
						class="{ds.playing
							? 'icon-[mingcute--pause-fill]'
							: 'icon-[mingcute--play-fill]'} size-6"
					></span>
				</button>
				<button
					title="Sync: take the other deck's tempo and line up the beats"
					aria-label="Sync"
					disabled={!canSync}
					class="size-12 rounded-full text-xs font-black ring-2 cursor-pointer transition bg-black/40 disabled:opacity-40 {ds.synced
						? 'ring-sky-300 text-sky-200 bg-sky-400/15'
						: 'ring-white/30 text-white/80 hover:bg-white/10'}"
					onclick={() => deck.sync(other)}>SYNC</button
				>
			</div>
		</div>

		<!-- Pads: hot cues, loops, jumps -->
		<div class="flex-1 min-w-0 flex flex-col gap-2">
			<div class="grid grid-cols-4 gap-1.5">
				{#each Array(HOT_CUES) as _, i (i)}
					{@const cue = ds.hotCues[i]}
					<button
						title={cue == null ? `Set hot cue ${i + 1}` : `Hot cue ${i + 1} (right-click to clear)`}
						aria-label="Hot cue {i + 1}"
						disabled={!loaded}
						class="h-9 rounded-md text-xs font-black cursor-pointer transition ring-1 disabled:opacity-40"
						style={cue == null
							? 'background: rgba(255,255,255,0.05); border-color: transparent; color: rgba(255,255,255,0.45)'
							: `background: ${HOT_COLORS[i]}; color: black`}
						onclick={() => deck.hotCue(i)}
						oncontextmenu={(e) => {
							e.preventDefault();
							deck.clearHotCue(i);
						}}
					>
						{i + 1}
					</button>
				{/each}
			</div>
			<div class="flex items-center gap-1 flex-wrap">
				<span class="text-[10px] font-bold text-white/40 w-9">LOOP</span>
				{#each LOOPS as beats (beats)}
					{@render button(loopText(beats), () => deck.loop(beats), {
						active: ds.loop?.beats === beats,
						tone: 'green',
						title: `Loop ${loopText(beats)} ${beats === 1 ? 'beat' : 'beats'}`
					})}
				{/each}
			</div>
			<div class="flex items-center gap-1 flex-wrap">
				<span class="text-[10px] font-bold text-white/40 w-9"></span>
				{@render button('½×', () => deck.halveLoop(), { title: 'Half the loop' })}
				{@render button('2×', () => deck.doubleLoop(), { title: 'Double the loop' })}
				{@render button('EXIT', () => deck.exitLoop(), { wide: true, title: 'Leave the loop' })}
			</div>
			<div class="flex items-center gap-1 flex-wrap">
				<span class="text-[10px] font-bold text-white/40 w-9">JUMP</span>
				{@render button('-16', () => deck.beatJump(-16), { title: 'Back 16 beats' })}
				{@render button('-4', () => deck.beatJump(-4), { title: 'Back 4 beats' })}
				{@render button('-1', () => deck.beatJump(-1), { title: 'Back a beat' })}
				{@render button('+1', () => deck.beatJump(1), { title: 'Ahead a beat' })}
				{@render button('+4', () => deck.beatJump(4), { title: 'Ahead 4 beats' })}
				{@render button('+16', () => deck.beatJump(16), { title: 'Ahead 16 beats' })}
			</div>
			<div class="flex items-end gap-3 pt-1">
				<Knob
					label="Echo"
					value={ds.echo}
					min={0}
					max={1}
					center={0}
					{color}
					format={(v) => `${Math.round(v * 100)}%`}
					onchange={(v) => deck.set({ echo: v })}
				/>
				<Knob
					label="Reverb"
					value={ds.reverb}
					min={0}
					max={1}
					center={0}
					{color}
					format={(v) => `${Math.round(v * 100)}%`}
					onchange={(v) => deck.set({ reverb: v })}
				/>
				<div class="ml-auto flex gap-1">
					<button
						title="Hold to slow down a little (line up the beats by ear)"
						aria-label="Nudge back"
						class="h-8 px-2 rounded-md bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/15 cursor-pointer"
						onpointerdown={() => deck.setBend(-0.04)}
						onpointerup={() => deck.setBend(0)}
						onpointerleave={() => deck.setBend(0)}
					>
						<span class="icon-[mingcute--left-line] size-4"></span>
					</button>
					<button
						title="Hold to speed up a little"
						aria-label="Nudge ahead"
						class="h-8 px-2 rounded-md bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/15 cursor-pointer"
						onpointerdown={() => deck.setBend(0.04)}
						onpointerup={() => deck.setBend(0)}
						onpointerleave={() => deck.setBend(0)}
					>
						<span class="icon-[mingcute--right-line] size-4"></span>
					</button>
					<button
						title="Eject"
						aria-label="Eject"
						class="h-8 px-2 rounded-md bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/15 cursor-pointer"
						onclick={() => deck.eject()}
					>
						<span class="icon-[mingcute--arrow-to-up-line] size-4"></span>
					</button>
				</div>
			</div>
		</div>

		<!-- Tempo -->
		<div class="flex flex-col items-center gap-1">
			<span class="text-[10px] font-bold text-white/40">TEMPO</span>
			<Fader
				value={ds.tempo}
				min={-ds.tempoRange}
				max={ds.tempoRange}
				center={0}
				inverted
				length={170}
				label="Tempo"
				onchange={(v) => deck.setTempo(v)}
			/>
			<button
				title="Tempo range"
				class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/[0.06] text-white/70 hover:bg-white/15 cursor-pointer"
				onclick={() => {
					const i = TEMPO_RANGES.indexOf(ds.tempoRange);
					const range = TEMPO_RANGES[(i + 1) % TEMPO_RANGES.length];
					deck.set({ tempoRange: range });
					if (Math.abs(ds.tempo) > range) deck.setTempo(Math.sign(ds.tempo) * range);
				}}
			>
				±{Math.round(ds.tempoRange * 100)}%
			</button>
			<span class="text-[10px] tabular-nums text-white/60">{tempoText(ds.tempo)}</span>
		</div>
	</div>
</section>
