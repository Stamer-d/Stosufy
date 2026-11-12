<script>
	// A song or a video being edited: played (the part kept, the effects as far as the player
	// can show them), cut on the timeline, faded, made louder or quieter, faster or slower,
	// turned, mirrored, and saved in a format.
	import { onDestroy, onMount } from 'svelte';
	import { showToast } from '#lib/stores/toast.ts';
	import { detectFormat, editTargets, extensionOf } from '../files/formats.ts';
	import { cancel, probe, release } from '../files/ffmpeg.ts';
	import { reveal } from '../files/save.ts';
	import Formats from '../files/Formats.svelte';
	import CopyButton from '../files/CopyButton.svelte';
	import { dragOut } from '../files/dragout.ts';
	import { notifyDone } from '../files/notify.ts';
	import { playable } from '../files/picked.ts';
	import Timeline from './Timeline.svelte';
	import { freshEdit, isEdited, lengthOf, saveMedia } from './media.ts';
	import { clock, parseClock, waveform } from './waveform.ts';

	/** @type {{ file: File, video: boolean }} */
	let { file, video } = $props();

	// (a file of its own each time: the page makes a new editor for another file)
	// svelte-ignore state_referenced_locally
	const url = playable(file);
	// svelte-ignore state_referenced_locally
	const targets = editTargets(detectFormat(file));
	/** @type {['start' | 'end', string, string][]} */
	const MARKS = [
		['start', 'Start', 'I'],
		['end', 'End', 'O']
	];
	const FADES = [0, 1, 3];
	const VOLUMES = [-6, -3, 0, 3, 6];
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

	let player = $state();
	let duration = $state(0);
	/** The player can't play it (the browser doesn't know the format): cut by the numbers */
	let unplayable = $state(false);
	let edit = $state(freshEdit(0));
	let time = $state(0);
	let playing = $state(false);
	let peaks = $state(null);
	let saving = $state({ status: 'idle', progress: 0, saved: null, error: '' });
	const id = `edit-${Math.random().toString(36).slice(2, 8)}`;

	function ready(seconds) {
		if (!Number.isFinite(seconds) || seconds <= 0) return;
		duration = seconds;
		edit = freshEdit(seconds);
	}

	async function unplayableFile() {
		unplayable = true;
		try {
			ready((await probe(file, extensionOf(file.name))).duration);
		} catch (error) {
			console.warn('Could not read the file:', error);
		}
	}

	onMount(() => {
		waveform(file).then((found) => (peaks = found));
		const keys = (event) => {
			const target = event.target;
			if (target instanceof HTMLElement && target.closest('input, select, textarea')) return;
			if (event.key === ' ' && !(target instanceof HTMLButtonElement)) {
				event.preventDefault();
				toggle();
			} else if (event.key === 'i' || event.key === 'I') setStart();
			else if (event.key === 'o' || event.key === 'O') setEnd();
		};
		window.addEventListener('keydown', keys);
		return () => window.removeEventListener('keydown', keys);
	});

	onDestroy(() => {
		player?.pause();
		if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		if (saving.status === 'working') void cancel(id);
		void release(file);
	});

	// The effects, as far as the player can show them
	$effect(() => {
		if (!player) return;
		player.playbackRate = edit.speed;
		player.preservesPitch = edit.keepPitch;
		player.volume = Math.min(1, Math.pow(10, edit.volume / 20));
		player.muted = edit.mute;
	});

	let frame = 0;
	function follow() {
		if (!player) return;
		time = player.currentTime;
		if (time >= edit.end) {
			player.pause();
			player.currentTime = edit.start;
			time = edit.start;
		}
		if (playing) frame = requestAnimationFrame(follow);
	}

	function toggle() {
		if (!player || unplayable) return;
		if (playing) return player.pause();
		if (player.currentTime < edit.start || player.currentTime >= edit.end - 0.05)
			player.currentTime = edit.start;
		player.play().catch(() => {});
	}

	function seek(seconds) {
		time = seconds;
		if (player && !unplayable) player.currentTime = seconds;
	}

	function setStart() {
		edit.start = Math.min(time, edit.end - 0.1);
	}
	function setEnd() {
		edit.end = Math.max(time, edit.start + 0.1);
	}

	function typed(which, text) {
		const seconds = parseClock(text);
		if (seconds === null) return;
		if (which === 'start') edit.start = Math.min(Math.max(0, seconds), edit.end - 0.1);
		else edit.end = Math.max(Math.min(duration, seconds), edit.start + 0.1);
	}

	async function save(targetId) {
		const target = targets.find((option) => option.id === targetId);
		if (!target) return;
		player?.pause();
		saving = { status: 'working', progress: 0, saved: null, error: '' };
		try {
			const saved = await saveMedia(
				file,
				$state.snapshot(edit),
				target,
				video,
				(progress) => (saving.progress = progress),
				id
			);
			saving = { status: 'done', progress: 1, saved, error: '' };
			void notifyDone('Saved', `${saved.name}, in Stosufy/Edited`);
		} catch (error) {
			if (error?.name === 'Cancelled') {
				saving = { status: 'idle', progress: 0, saved: null, error: '' };
				return;
			}
			console.warn('Could not save the edit:', error);
			saving = {
				status: 'failed',
				progress: 0,
				saved: null,
				error: error?.message ?? String(error)
			};
		}
	}

	async function show(path) {
		try {
			await reveal(path);
		} catch {
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	let edited = $derived(duration > 0 && isEdited(edit, duration));
	let turn = $derived(
		`rotate(${edit.rotate}deg)${edit.mirror ? ' scaleX(-1)' : ''}${edit.rotate % 180 ? ' scale(0.75)' : ''}`
	);
</script>

{#snippet choice(label, options, value, onpick, show = (option) => String(option))}
	<div class="flex items-center gap-2">
		<span class="w-24 shrink-0 text-sm text-white/60">{label}</span>
		<div
			class="inline-flex gap-0.5 p-0.5 rounded-full bg-white/[0.06]"
			role="radiogroup"
			aria-label={label}
		>
			{#each options as option (option)}
				<button
					role="radio"
					aria-checked={value === option}
					class="h-7 px-2.5 rounded-full text-xs font-bold cursor-pointer transition {value ===
					option
						? 'bg-white text-black'
						: 'text-white/70 hover:text-white'}"
					onclick={() => onpick(option)}
				>
					{show(option)}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

<div class="flex flex-col gap-4">
	<!-- What plays -->
	<div
		class="relative rounded-2xl overflow-hidden {video || unplayable
			? 'bg-black/40 ring-1 ring-white/5'
			: ''}"
	>
		{#if video}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={player}
				src={url}
				class="mx-auto max-h-[45vh] w-full object-contain transition-transform duration-200 {unplayable
					? 'hidden'
					: ''}"
				style="transform: {turn}"
				onloadedmetadata={() => ready(player.duration)}
				onerror={unplayableFile}
				onplay={() => {
					playing = true;
					follow();
				}}
				onpause={() => {
					playing = false;
					cancelAnimationFrame(frame);
				}}
				onclick={toggle}
			></video>
		{:else}
			<audio
				bind:this={player}
				src={url}
				onloadedmetadata={() => ready(player.duration)}
				onerror={unplayableFile}
				onplay={() => {
					playing = true;
					follow();
				}}
				onpause={() => {
					playing = false;
					cancelAnimationFrame(frame);
				}}
			></audio>
		{/if}
		{#if unplayable}
			<div class="h-28 flex items-center justify-center gap-3 text-white/50">
				<span
					class="{video ? 'icon-[mingcute--video-line]' : 'icon-[mingcute--music-2-line]'} size-8"
				></span>
				{#if unplayable}
					<span class="text-sm">
						This file can't be played here, but it can be cut by its times below.
					</span>
				{/if}
			</div>
		{/if}
	</div>

	{#if duration}
		<!-- Its time -->
		<Timeline {duration} bind:start={edit.start} bind:end={edit.end} {time} {peaks} onseek={seek} />
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
			<button
				class="size-10 grid place-items-center rounded-full bg-white text-black hover:bg-white/85 cursor-pointer transition disabled:opacity-40 disabled:cursor-default"
				aria-label={playing ? 'Pause' : 'Play'}
				title="Play the part kept (Space)"
				disabled={unplayable}
				onclick={toggle}
			>
				<span
					class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
				></span>
			</button>
			<span class="tabular-nums text-white/70 w-16">{clock(time)}</span>
			{#each MARKS as [which, label, key] (which)}
				<label class="flex items-center gap-1.5">
					<span class="text-white/60">{label}</span>
					<input
						class="w-20 h-8 px-2 rounded-lg bg-white/[0.06] tabular-nums font-semibold outline-none focus:ring-1 focus:ring-violet-300"
						aria-label="{label} time"
						value={clock(edit[which])}
						onchange={(event) => typed(which, event.currentTarget.value)}
					/>
					<button
						class="h-8 px-2 rounded-lg text-xs font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition disabled:opacity-40"
						title="{label} where it plays now ({key})"
						disabled={unplayable}
						onclick={which === 'start' ? setStart : setEnd}
					>
						Here
					</button>
				</label>
			{/each}
			<span class="ml-auto text-white/60">
				Length <span class="font-semibold text-white tabular-nums">{clock(lengthOf(edit))}</span>
			</span>
		</div>

		<!-- What's done to it -->
		<div
			class="grid gap-x-8 gap-y-3 p-4 rounded-2xl bg-white/[0.03] ring-1 ring-white/5 lg:grid-cols-2"
		>
			{@render choice(
				'Fade in',
				FADES,
				edit.fadeIn,
				(value) => (edit.fadeIn = value),
				(s) => (s ? `${s} s` : 'Off')
			)}
			{@render choice(
				'Fade out',
				FADES,
				edit.fadeOut,
				(value) => (edit.fadeOut = value),
				(s) => (s ? `${s} s` : 'Off')
			)}
			{@render choice(
				'Volume',
				VOLUMES,
				edit.volume,
				(value) => (edit.volume = value),
				(db) => (db ? `${db > 0 ? '+' : ''}${db} dB` : 'As is')
			)}
			{@render choice(
				'Speed',
				SPEEDS,
				edit.speed,
				(value) => (edit.speed = value),
				(x) => `${x}×`
			)}
			<label class="flex items-center gap-2 text-sm">
				<span class="w-24 shrink-0 text-white/60">Pitch</span>
				<input
					type="checkbox"
					class="accent-violet-400 size-4"
					checked={!edit.keepPitch}
					onchange={(event) => (edit.keepPitch = !event.currentTarget.checked)}
				/>
				Higher when faster (like a record, nightcore)
			</label>
			<label class="flex items-center gap-2 text-sm">
				<span class="w-24 shrink-0 text-white/60">Loudness</span>
				<input type="checkbox" class="accent-violet-400 size-4" bind:checked={edit.normalize} />
				Even it out (as loud as on streaming services)
			</label>
			{#if video}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-24 shrink-0 text-white/60">Picture</span>
					<button
						class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.06] hover:bg-white/15 cursor-pointer transition"
						onclick={() => (edit.rotate = /** @type {0|90|180|270} */ ((edit.rotate + 90) % 360))}
					>
						<span class="icon-[mingcute--clockwise-line] size-4"></span>
						Turn{edit.rotate ? ` (${edit.rotate}°)` : ''}
					</button>
					<button
						aria-pressed={edit.mirror}
						class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold cursor-pointer transition {edit.mirror
							? 'bg-white text-black'
							: 'bg-white/[0.06] hover:bg-white/15'}"
						onclick={() => (edit.mirror = !edit.mirror)}
					>
						<span class="icon-[mingcute--flip-horizontal-line] size-4"></span>
						Mirror
					</button>
					<button
						aria-pressed={edit.mute}
						class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold cursor-pointer transition {edit.mute
							? 'bg-white text-black'
							: 'bg-white/[0.06] hover:bg-white/15'}"
						onclick={() => (edit.mute = !edit.mute)}
					>
						<span class="icon-[mingcute--volume-off-line] size-4"></span>
						No sound
					</button>
				</div>
			{/if}
		</div>

		<!-- Saved as -->
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 pl-4 rounded-2xl bg-violet-300/[0.07] ring-1 ring-violet-300/20"
		>
			{#if saving.status === 'working'}
				<span class="text-sm font-semibold">Saving…</span>
				<div
					class="flex-1 min-w-40 h-1.5 rounded-full bg-white/10 overflow-hidden"
					role="progressbar"
				>
					{#if saving.progress > 0}
						<div
							class="h-full rounded-full bg-violet-300 transition-[width]"
							style="width: {saving.progress * 100}%"
						></div>
					{:else}
						<div class="h-full w-full rounded-full bg-violet-300/50 animate-pulse"></div>
					{/if}
				</div>
				<button
					class="h-8 px-3 rounded-full text-sm font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition"
					onclick={() => cancel(id)}
				>
					Stop
				</button>
			{:else}
				<span class="text-sm font-semibold text-violet-100">
					{edited ? 'Save as' : 'Nothing changed yet · save as'}
				</span>
				<Formats {targets} onpick={save} label="Save as" />
			{/if}
		</div>
		{#if saving.status === 'done' && saving.saved}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<button
					class="h-8 pl-2.5 pr-3 flex items-center gap-1.5 rounded-full font-semibold text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 cursor-pointer transition"
					title="Drag it out into a chat or a folder, or click to show it in its folder"
					use:dragOut={[saving.saved.path]}
					onclick={() => show(saving.saved.path)}
				>
					<span class="icon-[mingcute--check-circle-fill] size-4"></span>
					Saved: {saving.saved.name}
				</button>
				<CopyButton files={[saving.saved]} />
				<span class="text-white/50">in Stosufy/Edited</span>
			</div>
		{:else if saving.status === 'failed'}
			<p class="flex items-center gap-1.5 text-sm text-red-300">
				<span class="icon-[mingcute--warning-line] size-4"></span>
				{saving.error}
			</p>
		{/if}
	{:else if !unplayable}
		<p class="text-sm text-white/50">Reading the file…</p>
	{/if}
</div>
