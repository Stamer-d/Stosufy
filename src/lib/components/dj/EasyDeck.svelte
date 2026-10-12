<script>
	// A deck for the easy DJ mode: a big record to play, the song, and effect pads to hold
	import { onMount } from 'svelte';
	import SongCover from '../SongCover.svelte';
	import Overview from './Overview.svelte';
	import { songDrop } from '#lib/dj/library.ts';

	let { deck, other, state: ds, color, side = 'left' } = $props();

	let platter = $state();
	let remaining = $state('');
	let bpm = $state('');

	onMount(() => {
		let frame;
		const loop = () => {
			const pos = deck.position();
			const left = Math.max(0, deck.state.duration - pos);
			remaining = `-${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
			bpm = deck.state.duration ? deck.bpm(pos).toFixed(1) : '';
			if (platter) platter.style.transform = `rotate(${(pos / 1.8) * 360}deg)`;
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	// Turning the record: pushes the song along while it plays, moves through it while paused
	let jog = null;
	function jogDown(event) {
		if (!ds.duration) return;
		const rect = event.currentTarget.getBoundingClientRect();
		jog = {
			cx: rect.left + rect.width / 2,
			cy: rect.top + rect.height / 2,
			time: performance.now(),
			angle: 0
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

	const loaded = $derived(ds.duration > 0);
	const PADS = [
		{
			label: 'Filter',
			icon: 'icon-[mingcute--wave-line]',
			hold: (on) => deck.filterHold(on),
			tip: 'Hold: the sound thins out, let go: back'
		},
		{
			label: 'Echo',
			icon: 'icon-[mingcute--voice-line]',
			hold: (on) => deck.echoHold(on),
			tip: 'Hold: an echo on the beat'
		},
		{
			label: 'Roll ½',
			icon: 'icon-[mingcute--repeat-line]',
			hold: (on) => deck.roll(0.5, on),
			tip: 'Hold: repeats half a beat, let go: goes on in time'
		},
		{
			label: 'Roll 1',
			icon: 'icon-[mingcute--repeat-line]',
			hold: (on) => deck.roll(1, on),
			tip: 'Hold: repeats a beat, let go: goes on in time'
		}
	];
</script>

<section
	use:songDrop={(song) => deck.userLoad(song)}
	class="flex-1 min-w-0 flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.035] ring-1 ring-white/[0.06] transition data-[dropping=true]:ring-2 data-[dropping=true]:ring-white/70 data-[dropping=true]:bg-white/[0.09]"
>
	<div class="flex items-center gap-4 {side === 'right' ? 'flex-row-reverse text-right' : ''}">
		<!-- The record -->
		<div
			class="relative shrink-0 size-40 rounded-full bg-gradient-to-b from-zinc-700 to-zinc-950 ring-2 ring-black shadow-2xl shadow-black/60 cursor-grab active:cursor-grabbing touch-none select-none"
			role="slider"
			aria-label="Record of deck {deck.id}: turn it to push or scrub"
			aria-valuenow={0}
			tabindex="-1"
			ondragstart={(e) => e.preventDefault()}
			onpointerdown={jogDown}
			onpointermove={jogMove}
			onpointerup={jogUp}
			onpointercancel={jogUp}
		>
			<div
				bind:this={platter}
				class="absolute inset-2 rounded-full overflow-hidden pointer-events-none"
			>
				{#if ds.song}
					<SongCover
						setId={ds.song.id}
						track={ds.song.track}
						title={ds.song.title}
						class="size-full"
					/>
				{:else}
					<div class="size-full grid place-items-center text-white/30 text-xs text-center px-6">
						Drop a song here
					</div>
				{/if}
				<div
					class="absolute inset-0 rounded-full bg-[repeating-radial-gradient(circle,transparent_0,transparent_3px,rgba(0,0,0,0.12)_4px)]"
				></div>
				<div
					class="absolute left-1/2 top-1.5 -translate-x-1/2 w-1 h-7 rounded-full bg-white/90"
				></div>
			</div>
			<div
				class="absolute inset-[44%] rounded-full bg-zinc-900 ring-2 pointer-events-none"
				style="--tw-ring-color: {ds.playing ? color : 'rgba(255,255,255,0.2)'}"
			></div>
		</div>

		<div class="min-w-0 flex-1">
			<span
				class="inline-grid place-items-center size-7 rounded-md text-xs font-black text-black mb-1"
				style="background: {color}">{deck.id}</span
			>
			{#if ds.song}
				<p class="text-lg font-black leading-tight line-clamp-2">{ds.song.title}</p>
				<p class="text-sm text-white/50 truncate">{ds.song.artist}</p>
				{#if ds.loading}<p class="text-xs text-white/50 mt-1">Loading…</p>{/if}
				{#if ds.error}<p class="text-xs text-red-400 mt-1">{ds.error}</p>{/if}
			{:else}
				<p class="text-white/50">Drag a song from the list onto this deck</p>
			{/if}
			<p class="mt-2 text-3xl font-black tabular-nums leading-none" style="color: {color}">
				{bpm}<span class="text-xs text-white/40 font-bold ml-1">{bpm ? 'BPM' : ''}</span
				>{#if ds.key}<span
						class="ml-2 align-middle px-1.5 py-0.5 rounded-md bg-white/10 text-xs font-bold text-white/70"
						title="The song's key (Camelot): neighbours on the wheel mix in harmony">{ds.key}</span
					>{/if}
			</p>
			<p class="text-sm tabular-nums text-white/60">{loaded ? remaining : ''}</p>
		</div>
	</div>

	<Overview {deck} {color} height={28} />

	<div class="flex items-center gap-2 {side === 'right' ? 'flex-row-reverse' : ''}">
		<button
			title={ds.playing ? 'Pause' : 'Play'}
			aria-label={ds.playing ? 'Pause' : 'Play'}
			disabled={!loaded}
			class="size-14 grid place-items-center rounded-full cursor-pointer transition disabled:opacity-40 {ds.playing
				? 'text-black'
				: 'bg-white/10 text-white hover:bg-white/20'}"
			style={ds.playing ? `background: ${color}` : ''}
			onclick={() => deck.toggle()}
		>
			<span
				class="{ds.playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-7"
			></span>
		</button>
		<button
			title="Cue: back to the start point (hold while paused to listen)"
			aria-label="Cue"
			disabled={!loaded}
			class="h-10 px-4 rounded-full text-xs font-black ring-1 ring-amber-400/60 text-amber-300 hover:bg-amber-400/10 cursor-pointer disabled:opacity-40"
			onpointerdown={() => deck.cueDown()}
			onpointerup={() => deck.cueUp()}
			onpointerleave={() => deck.cueUp()}>CUE</button
		>
		<button
			title={ds.synced
				? 'Synced to the other deck (click to stop)'
				: 'Match the other deck: tempo and beat'}
			aria-label="Sync"
			aria-pressed={ds.synced}
			disabled={!loaded || !other.state.duration}
			class="h-10 px-4 rounded-full text-xs font-black ring-1 cursor-pointer transition disabled:opacity-40 {ds.synced
				? 'bg-sky-400/20 ring-sky-300 text-sky-200'
				: 'ring-white/20 text-white/80 hover:bg-white/10'}"
			onclick={() => (ds.synced ? deck.unsync() : deck.sync(other))}>SYNC</button
		>
		<button
			title="Stop like a record (brake)"
			aria-label="Brake"
			disabled={!ds.playing}
			class="h-10 px-3 rounded-full text-xs font-black ring-1 ring-white/20 text-white/80 hover:bg-white/10 cursor-pointer disabled:opacity-40"
			onclick={() => deck.brake()}>STOP</button
		>
	</div>

	<!-- Effects: hold a pad -->
	<div class="grid grid-cols-4 gap-2">
		{#each PADS as pad (pad.label)}
			<button
				title={pad.tip}
				disabled={!ds.playing}
				class="h-14 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-white/[0.06] ring-1 ring-white/10 text-white/80 text-xs font-bold cursor-pointer select-none touch-none transition active:scale-95 disabled:opacity-30 hover:bg-white/10"
				style="--pad: {color}"
				onpointerdown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					e.currentTarget.style.background = color;
					e.currentTarget.style.color = 'black';
					pad.hold(true);
				}}
				onpointerup={(e) => {
					e.currentTarget.style.background = '';
					e.currentTarget.style.color = '';
					pad.hold(false);
				}}
				onpointercancel={(e) => {
					e.currentTarget.style.background = '';
					e.currentTarget.style.color = '';
					pad.hold(false);
				}}
			>
				<span class="{pad.icon} size-5"></span>
				{pad.label}
			</button>
		{/each}
	</div>
</section>
