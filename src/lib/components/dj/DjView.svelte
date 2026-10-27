<script>
	// The DJ mode: two decks, a mixer and the songs, filling the window
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
	import * as path from '@tauri-apps/api/path';
	import Titlebar from '../Titlebar.svelte';
	import Deck from './Deck.svelte';
	import Mixer from './Mixer.svelte';
	import Waveform from './Waveform.svelte';
	import Browser from './Browser.svelte';
	import EasyDeck from './EasyDeck.svelte';
	import EasyMix from './EasyMix.svelte';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { dj, djMixer, djOpen } from '#lib/dj/engine.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { showToast } from '#lib/stores/toast.ts';

	const COLORS = { A: '#38bdf8', B: '#fb923c' };
	const HELP =
		'Drag the waveforms to scrub, scroll to zoom · right-click a hot cue to clear it · Keys: Q/P play, A/L cue, 1–4/7–0 hot cues, Z/M sync, Space mix, ←→ crossfader';
	const mixer = djMixer();
	/** Easy (big decks, one mix button, effect pads) or Pro (all the controls) */
	const MODES = [
		{ value: false, label: 'Easy' },
		{ value: true, label: 'Pro' }
	];
	let pro = $derived($userSettings.settings?.djPro ?? false);
	mixer.emit();

	// The music never stops: what plays goes on in the DJ mode, and back in the player after
	onMount(() => {
		keybindsPaused.set(true);
		mixer.takeFromPlayer();
	});
	onDestroy(() => {
		keybindsPaused.set(false);
		if ($dj?.recording) saveRecording();
		mixer.handToPlayer();
	});

	async function saveRecording() {
		const blob = await mixer.stopRecording();
		if (!blob || !blob.size) return;
		try {
			const dir = await path.join(await path.homeDir(), 'Stosufy', 'Mixes');
			await mkdir(dir, { recursive: true });
			const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
			const extension = blob.type.includes('ogg')
				? 'ogg'
				: blob.type.includes('mp4')
					? 'm4a'
					: 'webm';
			const file = await path.join(dir, `Mix ${stamp}.${extension}`);
			await writeFile(file, new Uint8Array(await blob.arrayBuffer()));
			showToast(`Saved your mix to ${file}`, 'icon-[mingcute--record-mail-line]');
		} catch (error) {
			console.error('Could not save the mix:', error);
			showToast("Couldn't save the recording", 'icon-[mingcute--warning-line]');
		}
	}

	// Keys like on a controller: Q / P play, A / L cue (hold), 1–4 / 7–0 hot cues, Z / M sync,
	// Space mixes, ← → move the crossfader
	const HOT_KEYS = { A: ['1', '2', '3', '4'], B: ['7', '8', '9', '0'] };
	function keydown(event) {
		const target = event.target;
		if (target instanceof HTMLElement && target.closest('input, textarea, select')) return;
		// Space on a focused button (just clicked, like SYNC) is that button's, not a mix
		if (
			target instanceof HTMLElement &&
			target.closest('button') &&
			(event.key === ' ' || event.key === 'Enter')
		)
			return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.key.toLowerCase();
		const { A, B } = mixer.decks;
		const actions = {
			q: () => A.toggle(),
			p: () => B.toggle(),
			z: () => A.sync(B),
			m: () => B.sync(A),
			' ': () => mixer.mix(),
			arrowleft: () => mixer.setCrossfader(mixer.crossfader - 0.05),
			arrowright: () => mixer.setCrossfader(mixer.crossfader + 0.05)
		};
		if (event.repeat && key !== 'arrowleft' && key !== 'arrowright') return;
		if (key === 'a' || key === 'l') {
			(key === 'a' ? A : B).cueDown();
		} else if (actions[key]) {
			actions[key]();
		} else {
			for (const id of ['A', 'B']) {
				const index = HOT_KEYS[id].indexOf(key);
				if (index >= 0) mixer.decks[id].hotCue(index);
			}
			if (!HOT_KEYS.A.includes(key) && !HOT_KEYS.B.includes(key)) return;
		}
		event.preventDefault();
	}
	function keyup(event) {
		const key = event.key.toLowerCase();
		if (key === 'a') mixer.decks.A.cueUp();
		if (key === 'l') mixer.decks.B.cueUp();
	}

	// What Auto DJ does next, shown so a mix never comes as a surprise
	let auto = $state(null);
	onMount(() => {
		const timer = setInterval(() => (auto = mixer.autoStatus()), 500);
		return () => clearInterval(timer);
	});

	const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<svelte:window
	onkeydown={(e) => {
		mixer.noteUser();
		keydown(e);
	}}
	onkeyup={keyup}
	onpointerdown={() => mixer.noteUser()}
/>

<div
	class="fixed inset-0 z-40 flex flex-col bg-[#0d0d11] text-white"
	transition:fade={{ duration: 150 }}
>
	<div class="relative">
		<Titlebar />
	</div>
	{#if $dj}
		<!-- (its parts keep their height: in a low window it scrolls instead of squeezing them) -->
		<div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 px-3 pb-3 [&>*]:shrink-0">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h1 class="shrink-0 text-lg font-black tracking-tight">
					<span class="icon-[mingcute--disc-line] size-5 align-[-3px] mr-1"></span>DJ
				</h1>
				<!-- The tips: in a line when there's room, else behind a ? -->
				<span class="hidden 2xl:block min-w-0 flex-1 truncate text-xs text-white/40" title={HELP}>
					{HELP}
				</span>
				<div class="relative group/help 2xl:hidden">
					<button
						class="size-7 grid place-items-center rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-help"
						aria-label="Tips and keys"
						aria-describedby="dj-help"
					>
						<span class="icon-[mingcute--question-line] size-4"></span>
					</button>
					<p
						id="dj-help"
						role="tooltip"
						class="absolute left-0 top-full mt-1 z-30 w-72 p-3 rounded-lg bg-zinc-900 ring-1 ring-white/10 shadow-xl text-xs leading-relaxed text-white/70 invisible opacity-0 group-hover/help:visible group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:opacity-100 transition-opacity"
					>
						{HELP}
					</p>
				</div>
				<div class="ml-auto min-w-0 flex flex-wrap items-center justify-end gap-2">
					{#if auto}
						<div
							class="min-w-0 max-w-full flex items-center gap-2 h-8 pl-3 pr-1 rounded-full text-xs ring-1 {auto.mixing ||
							(auto.seconds != null && auto.seconds < 15)
								? 'bg-amber-400/15 ring-amber-300/40 text-amber-100'
								: 'bg-white/[0.06] ring-white/10 text-white/75'}"
						>
							<span class="shrink-0 font-black tracking-wide whitespace-nowrap">AUTO DJ</span>
							<span class="min-w-0 max-w-[28rem] truncate">
								{#if auto.mixing}
									Mixing into {auto.song?.title ?? 'the next song'}…
								{:else if !auto.song}
									Loading the next song…
								{:else if auto.seconds == null}
									Next: {auto.song.title} · waiting for you
								{:else}
									Mixes into {auto.song.title} in {clock(auto.seconds)}{auto.how
										? ` · ${auto.how}`
										: ''}
								{/if}
							</span>
							<button
								class="shrink-0 h-6 px-2.5 rounded-full bg-white/10 hover:bg-white/20 font-bold cursor-pointer"
								title="Mix by hand: Auto DJ stops mixing on its own"
								onclick={() => mixer.stopAuto()}>Off</button
							>
						</div>
					{/if}
					<div
						class="shrink-0 flex p-1 rounded-full bg-white/[0.06] ring-1 ring-white/10"
						role="group"
						aria-label="Controls"
					>
						{#each MODES as { value, label } (label)}
							<button
								aria-pressed={pro === value}
								title={value
									? 'All the controls: EQ, loops, hot cues, tempo'
									: 'Big decks, one mix button and effect pads'}
								class="h-6 px-3 rounded-full text-xs font-bold cursor-pointer transition {pro ===
								value
									? 'bg-white text-black'
									: 'text-white/60 hover:text-white'}"
								onclick={() => updateUserSettings({ djPro: value })}>{label}</button
							>
						{/each}
					</div>
					<button
						title={$dj.recording ? 'Stop recording and save the mix' : 'Record the mix'}
						aria-pressed={$dj.recording}
						class="shrink-0 h-8 px-3 rounded-full text-xs font-black whitespace-nowrap cursor-pointer ring-1 transition {$dj.recording
							? 'bg-red-500 ring-red-300 text-white'
							: 'bg-white/[0.06] ring-white/10 text-white/80 hover:text-white'}"
						onclick={() => {
							if ($dj.recording) saveRecording();
							else if (!mixer.startRecording())
								showToast("Recording mixes isn't possible here", 'icon-[mingcute--warning-line]');
						}}
					>
						<span
							class="inline-block size-2 rounded-full bg-current mr-1 {$dj.recording
								? 'animate-pulse'
								: ''}"
						></span>
						{$dj.recording ? `REC ${clock($dj.recordedSeconds)}` : 'REC'}
					</button>
					<button
						class="shrink-0 h-8 px-3 rounded-full text-xs font-bold whitespace-nowrap bg-white/[0.06] ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer"
						title="Leave DJ mode"
						onclick={() => djOpen.set(false)}
					>
						<span class="icon-[mingcute--close-line] size-4 align-[-3px]"></span>
						<span class="max-lg:sr-only">Leave DJ mode</span>
					</button>
				</div>
			</div>

			<div class="rounded-xl overflow-hidden ring-1 ring-white/[0.06] bg-black/50">
				<Waveform deck={mixer.decks.A} color={COLORS.A} height={96} />
				<div class="h-px bg-white/10"></div>
				<Waveform deck={mixer.decks.B} color={COLORS.B} height={96} />
			</div>

			<!-- In narrow windows both decks on top, the mixer under them -->
			{#if pro}
				<div
					class="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-stretch"
				>
					<Deck
						deck={mixer.decks.A}
						other={mixer.decks.B}
						state={$dj.A}
						color={COLORS.A}
						side="left"
					/>
					<div class="col-span-2 order-last lg:col-span-1 lg:order-none flex justify-center">
						<Mixer {mixer} state={$dj} colors={COLORS} />
					</div>
					<Deck
						deck={mixer.decks.B}
						other={mixer.decks.A}
						state={$dj.B}
						color={COLORS.B}
						side="right"
					/>
				</div>
			{:else}
				<div
					class="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-stretch"
				>
					<EasyDeck
						deck={mixer.decks.A}
						other={mixer.decks.B}
						state={$dj.A}
						color={COLORS.A}
						side="left"
					/>
					<div class="col-span-2 order-last lg:col-span-1 lg:order-none flex">
						<EasyMix {mixer} state={$dj} colors={COLORS} />
					</div>
					<EasyDeck
						deck={mixer.decks.B}
						other={mixer.decks.A}
						state={$dj.B}
						color={COLORS.B}
						side="right"
					/>
				</div>
			{/if}

			<Browser {mixer} state={$dj} colors={COLORS} />
		</div>
	{/if}
</div>
