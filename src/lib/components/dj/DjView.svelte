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
	const mixer = djMixer();
	/** Easy (big decks, one mix button, effect pads) or Pro (all the controls) */
	const MODES = [
		{ value: false, label: 'Easy' },
		{ value: true, label: 'Pro' }
	];
	let pro = $derived($userSettings.settings?.djPro ?? false);
	mixer.emit();

	onMount(() => keybindsPaused.set(true));
	onDestroy(() => {
		keybindsPaused.set(false);
		mixer.stopAll();
		if ($dj?.recording) saveRecording();
	});

	async function saveRecording() {
		const blob = await mixer.stopRecording();
		if (!blob || !blob.size) return;
		try {
			const dir = await path.join(await path.homeDir(), 'Stosufy', 'Mixes');
			await mkdir(dir, { recursive: true });
			const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
			const extension = blob.type.includes('ogg') ? 'ogg' : 'webm';
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

	const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} />

<div
	class="fixed inset-0 z-40 flex flex-col bg-[#0d0d11] text-white"
	transition:fade={{ duration: 150 }}
>
	<div class="relative">
		<Titlebar />
	</div>
	{#if $dj}
		<div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 px-3 pb-3">
			<div class="flex items-center gap-3">
				<h1 class="text-lg font-black tracking-tight">
					<span class="icon-[mingcute--disc-line] size-5 align-[-3px] mr-1"></span>DJ
				</h1>
				<span class="text-xs text-white/40">
					Drag the waveforms to scrub, scroll to zoom · right-click a hot cue to clear it · Keys:
					Q/P play, A/L cue, 1–4/7–0 hot cues, Z/M sync, Space mix, ←→ crossfader
				</span>
				<div class="ml-auto flex items-center gap-2">
					<div
						class="flex p-1 rounded-full bg-white/[0.06] ring-1 ring-white/10"
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
						class="h-8 px-3 rounded-full text-xs font-black cursor-pointer ring-1 transition {$dj.recording
							? 'bg-red-500 ring-red-300 text-white'
							: 'bg-white/[0.06] ring-white/10 text-white/80 hover:text-white'}"
						onclick={() => ($dj.recording ? saveRecording() : mixer.startRecording())}
					>
						<span
							class="inline-block size-2 rounded-full bg-current mr-1 {$dj.recording
								? 'animate-pulse'
								: ''}"
						></span>
						{$dj.recording ? `REC ${clock($dj.recordedSeconds)}` : 'REC'}
					</button>
					<button
						class="h-8 px-3 rounded-full text-xs font-bold bg-white/[0.06] ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer"
						onclick={() => djOpen.set(false)}
					>
						<span class="icon-[mingcute--close-line] size-4 align-[-3px]"></span>
						Leave DJ mode
					</button>
				</div>
			</div>

			<div class="rounded-xl overflow-hidden ring-1 ring-white/[0.06] bg-black/50">
				<Waveform deck={mixer.decks.A} color={COLORS.A} height={96} />
				<div class="h-px bg-white/10"></div>
				<Waveform deck={mixer.decks.B} color={COLORS.B} height={96} />
			</div>

			{#if pro}
				<div class="flex gap-2 items-stretch">
					<Deck
						deck={mixer.decks.A}
						other={mixer.decks.B}
						state={$dj.A}
						color={COLORS.A}
						side="left"
					/>
					<Mixer {mixer} state={$dj} colors={COLORS} />
					<Deck
						deck={mixer.decks.B}
						other={mixer.decks.A}
						state={$dj.B}
						color={COLORS.B}
						side="right"
					/>
				</div>
			{:else}
				<div class="flex gap-2 items-stretch">
					<EasyDeck
						deck={mixer.decks.A}
						other={mixer.decks.B}
						state={$dj.A}
						color={COLORS.A}
						side="left"
					/>
					<EasyMix {mixer} state={$dj} colors={COLORS} />
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
