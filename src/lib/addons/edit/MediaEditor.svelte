<script>
	// A song or a video being edited: played (what's kept, the effects as far as the player can
	// show them), cut on the timeline (zoomed in as far as wanted), split into parts and parts
	// taken out, faded, made louder or quieter, faster or slower, a video turned, mirrored and
	// cut to a part of its picture, a frame of it saved as a picture, undone and redone, and
	// saved in a format, as one file or a file for each part.
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
	import CropBox from './CropBox.svelte';
	import Undo from './Undo.svelte';
	import { SHAPES, biggest, ratioOf } from './crop.ts';
	import { createHistory } from './history.svelte.ts';
	import {
		addCut,
		freshEdit,
		isCropped,
		isEdited,
		keptOf,
		lengthOf,
		partsOf,
		removeCut,
		saveFrame,
		saveMedia,
		togglePart
	} from './media.ts';
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
	/** The video's picture (px) */
	let size = $state({ width: 16, height: 9 });
	/** The player can't play it (the browser doesn't know the format): cut by the numbers */
	let unplayable = $state(false);
	let edit = $state(freshEdit(0));
	let time = $state(0);
	let playing = $state(false);
	let wave = $state(null);
	let cropping = $state(false);
	let shape = $state('free');
	/** @type {{ status: string, progress: number, saved: import('../files/save.ts').SavedFile[], error: string }} */
	let saving = $state({ status: 'idle', progress: 0, saved: [], error: '' });
	let frameSaved = $state(null);
	const id = `edit-${Math.random().toString(36).slice(2, 8)}`;

	const history = createHistory((value) => (edit = value));
	$effect(() => {
		if (duration) history.changed($state.snapshot(edit));
	});

	function ready(seconds, width = 0, height = 0) {
		if (!Number.isFinite(seconds) || seconds <= 0) return;
		duration = seconds;
		if (width && height) size = { width, height };
		edit = freshEdit(seconds);
		history.reset();
	}

	async function unplayableFile() {
		unplayable = true;
		try {
			const info = await probe(file, extensionOf(file.name));
			ready(info.duration, info.width, info.height);
		} catch (error) {
			console.warn('Could not read the file:', error);
		}
	}

	onMount(() => {
		waveform(file).then((found) => (wave = found));
		const keys = (event) => {
			if (history.key(event)) return;
			const target = event.target;
			if (target instanceof HTMLElement && target.closest('input, select, textarea')) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.key === ' ' && !(target instanceof HTMLButtonElement)) {
				event.preventDefault();
				toggle();
			} else if (event.key === 'i' || event.key === 'I') setStart();
			else if (event.key === 'o' || event.key === 'O') setEnd();
			else if (event.key === 's' || event.key === 'S') split();
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

	let parts = $derived(duration ? partsOf(edit, duration) : []);
	let kept = $derived(duration ? keptOf(edit, duration) : []);

	let frame = 0;
	/** Where it plays: over the parts taken out, stopped at the end */
	function follow() {
		if (!player) return;
		time = player.currentTime;
		const next = kept.find((part) => part.to > time + 0.01);
		if (!next) {
			player.pause();
			time = player.currentTime = kept[0]?.from ?? edit.start;
		} else if (time < next.from - 0.01) {
			time = player.currentTime = next.from;
		}
		if (playing) frame = requestAnimationFrame(follow);
	}

	function toggle() {
		if (!player || unplayable) return;
		if (playing) return player.pause();
		if (
			!kept.some((part) => player.currentTime >= part.from && player.currentTime < part.to - 0.05)
		)
			player.currentTime =
				kept.find((part) => part.from >= player.currentTime)?.from ?? kept[0]?.from ?? 0;
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
	/** A cut where it plays now: the parts on both sides can be taken out, or saved apart */
	function split() {
		addCut(edit, time, duration);
	}

	function typed(which, text) {
		const seconds = parseClock(text);
		if (seconds === null) return;
		if (which === 'start') edit.start = Math.min(Math.max(0, seconds), edit.end - 0.1);
		else edit.end = Math.max(Math.min(duration, seconds), edit.start + 0.1);
	}

	/** The video's picture as it's turned (px) */
	let turned = $derived(edit.rotate % 180 ? { width: size.height, height: size.width } : size);

	function turn() {
		edit.rotate = /** @type {0|90|180|270} */ ((edit.rotate + 90) % 360);
		edit.crop =
			shape === 'free'
				? { x: 0, y: 0, w: 1, h: 1 }
				: biggest(ratioOf(shape), turned.width, turned.height);
	}

	function chooseShape(id) {
		shape = id;
		const ratio = ratioOf(id);
		if (ratio) edit.crop = biggest(ratio, turned.width, turned.height);
	}

	async function save(targetId) {
		const target = targets.find((option) => option.id === targetId);
		if (!target) return;
		player?.pause();
		saving = { status: 'working', progress: 0, saved: [], error: '' };
		try {
			const saved = await saveMedia(
				file,
				$state.snapshot(edit),
				duration,
				target,
				video,
				(progress) => (saving.progress = progress),
				id
			);
			saving = { status: 'done', progress: 1, saved, error: '' };
			void notifyDone(
				'Saved',
				`${saved.length === 1 ? saved[0].name : `${saved.length} parts`}, in Stosufy/Edited`
			);
		} catch (error) {
			if (error?.name === 'Cancelled') {
				saving = { status: 'idle', progress: 0, saved: [], error: '' };
				return;
			}
			console.warn('Could not save the edit:', error);
			saving = { status: 'failed', progress: 0, saved: [], error: error?.message ?? String(error) };
		}
	}

	let grabbing = $state(false);
	async function grabFrame() {
		player?.pause();
		grabbing = true;
		try {
			frameSaved = await saveFrame(file, $state.snapshot(edit), time);
		} catch (error) {
			console.warn('Could not save the frame:', error);
			showToast("Couldn't save the frame", 'icon-[mingcute--warning-line]');
		} finally {
			grabbing = false;
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
	/** The video drawn turned and mirrored in the box of its turned picture */
	let videoStyle = $derived.by(() => {
		const sideways = edit.rotate % 180 !== 0;
		const w = sideways ? (size.width / size.height) * 100 : 100;
		const h = sideways ? (size.height / size.width) * 100 : 100;
		return `left: 50%; top: 50%; width: ${w}%; height: ${h}%; transform: translate(-50%, -50%) rotate(${edit.rotate}deg)${edit.mirror ? ' scaleX(-1)' : ''}`;
	});
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

{#snippet result(files)}
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<button
			class="h-8 pl-2.5 pr-3 flex items-center gap-1.5 rounded-full font-semibold text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 cursor-pointer transition"
			title="Drag it out into a chat or a folder, or click to show it in its folder"
			use:dragOut={files.map((saved) => saved.path)}
			onclick={() => show(files[0].path)}
		>
			<span class="icon-[mingcute--check-circle-fill] size-4"></span>
			Saved: {files.length === 1 ? files[0].name : `${files.length} parts`}
		</button>
		<CopyButton {files} />
		<span class="text-white/50">in Stosufy/Edited</span>
	</div>
{/snippet}

<div class="flex flex-col gap-4">
	<!-- What plays -->
	{#if video && !unplayable}
		<div
			class="grid place-items-center p-3 rounded-2xl bg-black/40 ring-1 ring-white/5 overflow-hidden isolate"
		>
			<CropBox
				width={turned.width}
				height={turned.height}
				bind:crop={edit.crop}
				ratio={ratioOf(shape)}
				active={cropping}
			>
				<!-- svelte-ignore a11y_media_has_caption, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<video
					bind:this={player}
					src={url}
					class="absolute max-w-none object-fill transition-transform duration-200"
					style={videoStyle}
					onloadedmetadata={() => ready(player.duration, player.videoWidth, player.videoHeight)}
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
			</CropBox>
		</div>
	{:else if !video}
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
		<div
			class="h-28 flex items-center justify-center gap-3 rounded-2xl bg-black/40 ring-1 ring-white/5 text-white/50"
		>
			<span class="{video ? 'icon-[mingcute--video-line]' : 'icon-[mingcute--music-2-line]'} size-8"
			></span>
			<span class="text-sm"
				>This file can't be played here, but it can be cut by its times below.</span
			>
		</div>
	{/if}

	{#if duration}
		<!-- Its time -->
		<Timeline
			{duration}
			bind:start={edit.start}
			bind:end={edit.end}
			{time}
			{wave}
			{parts}
			{playing}
			onseek={seek}
			ontoggle={(from) => togglePart(edit, from)}
			onuncut={(cut) => removeCut(edit, cut)}
		/>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
			<button
				class="size-10 grid place-items-center rounded-full bg-white text-black hover:bg-white/85 cursor-pointer transition disabled:opacity-40 disabled:cursor-default"
				aria-label={playing ? 'Pause' : 'Play'}
				title="Play what's kept (Space)"
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
			<button
				class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.06] hover:bg-white/15 cursor-pointer transition"
				title="Cut it in two where it plays now (S): take a part out, or save the parts apart"
				onclick={split}
			>
				<span class="icon-[mingcute--scissors-2-line] size-4"></span>
				Split here
			</button>
			<Undo {history} />
			<span class="ml-auto text-white/60">
				Length <span class="font-semibold text-white tabular-nums"
					>{clock(lengthOf(edit, duration))}</span
				>
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
				<div class="flex flex-wrap items-center gap-2 text-sm lg:col-span-2">
					<span class="w-24 shrink-0 text-white/60">Picture</span>
					<button
						class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.06] hover:bg-white/15 cursor-pointer transition"
						onclick={turn}
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
					{#if !unplayable}
						<button
							aria-pressed={cropping}
							class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold cursor-pointer transition {cropping
								? 'bg-white text-black'
								: 'bg-white/[0.06] hover:bg-white/15'}"
							title="Keep a part of the picture: drag it on the video"
							onclick={() => (cropping = !cropping)}
						>
							<span class="icon-[ri--crop-line] size-4"></span>
							Cut the picture{isCropped(edit.crop) && !cropping ? ' ✓' : ''}
						</button>
						{#if cropping}
							<div
								class="inline-flex gap-0.5 p-0.5 rounded-full bg-white/[0.06]"
								role="radiogroup"
								aria-label="Shape"
							>
								{#each SHAPES as [shapeId, label] (shapeId)}
									<button
										role="radio"
										aria-checked={shape === shapeId}
										class="h-7 px-2.5 rounded-full text-xs font-bold cursor-pointer transition {shape ===
										shapeId
											? 'bg-white text-black'
											: 'text-white/70 hover:text-white'}"
										onclick={() => chooseShape(shapeId)}
									>
										{label}
									</button>
								{/each}
							</div>
						{/if}
					{/if}
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
					<button
						class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.06] hover:bg-white/15 cursor-pointer transition disabled:opacity-50 disabled:cursor-default"
						title="Save the picture where it plays now (as PNG, turned and cut as above)"
						disabled={grabbing}
						onclick={grabFrame}
					>
						<span class="icon-[mingcute--camera-line] size-4"></span>
						{grabbing ? 'Saving the frame…' : 'Save this frame'}
					</button>
				</div>
			{/if}
		</div>
		{#if frameSaved}
			{@render result([frameSaved])}
		{/if}

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
				{#if kept.length > 1}
					<label class="ml-auto flex items-center gap-2 text-sm">
						<input type="checkbox" class="accent-violet-400 size-4" bind:checked={edit.eachPart} />
						Each of the {kept.length} parts as its own file
					</label>
				{/if}
			{/if}
		</div>
		{#if saving.status === 'done' && saving.saved.length}
			{@render result(saving.saved)}
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
