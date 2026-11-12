<script>
	// A song or a video being edited: played (what's kept, the effects as far as the player can
	// show them), cut on the timeline (zoomed in as far as wanted), split into parts and parts
	// taken out, faded, made louder or quieter, faster or slower, a video turned, mirrored and
	// cut to a part of its picture, a frame of it saved as a picture, undone and redone, and
	// saved in a format, as one file or a file for each part.
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { showToast } from '#lib/stores/toast.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { currentSong, stopPlayback } from '#lib/stores/audio.ts';
	import { detectFormat, editTargets, extensionOf } from '../files/formats.ts';
	import { cancel, probe, release } from '../files/ffmpeg.ts';
	import { reveal } from '../files/save.ts';
	import Formats from '../files/Formats.svelte';
	import CopyButton from '../files/CopyButton.svelte';
	import Dropdown from '../files/Dropdown.svelte';
	import Toggle from '../files/Toggle.svelte';
	import { radioKeys } from '../files/radio.ts';
	import { LIMITS, sizeLimit } from './limit.ts';
	import { dragOut } from '../files/dragout.ts';
	import { notifyDone } from '../files/notify.ts';
	import { playable } from '../files/picked.ts';
	import Timeline from './Timeline.svelte';
	import CropBox from './CropBox.svelte';
	import Undo from './Undo.svelte';
	import { SHAPES, biggest, ratioOf } from './crop.ts';
	import { createHistory } from './history.svelte.ts';
	import { createThumbnails } from './thumbnails.svelte.ts';
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

	/**
	 * @type {{
	 *   file: File,
	 *   video: boolean,
	 *   dirty?: boolean,
	 *   onkind?: (kind: 'audio') => void
	 * }}
	 */
	let { file, video, dirty = $bindable(false), onkind } = $props();

	// (a file of its own each time: the page makes a new editor for another file)
	// svelte-ignore state_referenced_locally
	const url = playable(file);
	// svelte-ignore state_referenced_locally
	const format = detectFormat(file);
	const allTargets = editTargets(format);
	/** Its formats; for a WebM or an MP4 with only sound in it, its sound's */
	let targets = $derived(
		!video && format?.kind === 'video'
			? allTargets.filter((target) => target.group === 'Only the sound')
			: allTargets
	);
	/** @type {['start' | 'end', string, string][]} */
	const MARKS = [
		['start', 'Start', 'I'],
		['end', 'End', 'O']
	];
	const FADES = [0, 1, 3].map((s) => ({ value: s, label: s ? `${s} s` : 'Off' }));
	const VOLUMES = [-6, -3, 0, 3, 6].map((db) => ({
		value: db,
		label: db ? `${db > 0 ? '+' : ''}${db} dB` : 'As is'
	}));
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2].map((x) => ({ value: x, label: `${x}×` }));

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
	/** @type {{ status: string, progress: number, saved: import('../files/save.ts').SavedFile[], error: string, note?: string }} */
	let saving = $state({ status: 'idle', progress: 0, saved: [], error: '' });
	let frameSaved = $state(null);
	/** It couldn't be read at all */
	let failed = $state('');
	/** The timeline (to zoom it), and how far it's zoomed in */
	let timeline = $state();
	let zoom = $state(1);
	/** The waveform's being read */
	let reading = $state(false);
	/** @type {import('./thumbnails.svelte.ts').Thumbnails | null} */
	let frames = $state.raw(null);
	const id = `edit-${Math.random().toString(36).slice(2, 8)}`;
	let gone = false;

	const history = createHistory((value) => {
		// (the part of the picture undone: it may not be in the shape chosen any more)
		if (JSON.stringify(value.crop) !== JSON.stringify(edit.crop)) shape = 'free';
		edit = value;
	});
	$effect(() => {
		if (duration) history.changed($state.snapshot(edit));
	});

	function ready(seconds, width = 0, height = 0) {
		// (a recording that doesn't say how long it is, as the browser's own: FFmpeg reads it)
		if (!Number.isFinite(seconds) || seconds <= 0) return void measure();
		if (duration) return;
		duration = seconds;
		if (width && height) size = { width, height };
		edit = freshEdit(seconds);
		history.reset();
		savedEdit();
		// (a video's pictures along its timeline, where the browser can play it)
		if (video && !unplayable) frames = createThumbnails(url);
		reading = true;
		void waveform(file, seconds, `${id}-wave`).then((found) => {
			if (gone) return;
			wave = found;
			reading = false;
		});
	}

	/** How long it is (and its picture's size), read by FFmpeg */
	async function measure() {
		try {
			const info = await probe(file, extensionOf(file.name));
			if (!(info.duration > 0)) throw new Error("It doesn't say how long it is");
			ready(info.duration, info.width, info.height);
		} catch (error) {
			console.warn('Could not read the file:', error);
			if (!gone) failed = "This file couldn't be read: is it a song or a video?";
		}
	}

	function unplayableFile() {
		unplayable = true;
		void measure();
	}

	function loaded() {
		// (a WebM or an MP4 with only sound in it: edited as a song)
		if (video && player && !player.videoWidth && !player.videoHeight && onkind) {
			onkind('audio');
			return;
		}
		ready(player.duration, player.videoWidth, player.videoHeight);
	}

	function started() {
		playing = true;
		// (not two things playing at once: the app's song stops)
		if (get(currentSong).isPlaying) stopPlayback();
		follow();
	}

	/** What it was when it was opened or last saved (to say when there's something to lose) */
	let lastSaved = $state('');
	const savedEdit = () => (lastSaved = JSON.stringify($state.snapshot(edit)));
	$effect(() => {
		dirty = !!duration && edited && JSON.stringify(edit) !== lastSaved;
	});

	// The app's shortcuts (Space: its song, …) not while editing: the editor's own
	$effect(() => {
		keybindsPaused.set(true);
		return () => keybindsPaused.set(false);
	});

	onMount(() => {
		const keys = (event) => {
			if (history.key(event)) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest(
					'input, select, textarea, [role="menu"], [role="listbox"], [role="radiogroup"]'
				)
			)
				return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && duration) {
				// (a tenth of a second; with Shift, a second)
				event.preventDefault();
				const by = (event.shiftKey ? 1 : 0.1) * (event.key === 'ArrowLeft' ? -1 : 1);
				seek(Math.min(duration, Math.max(0, time + by)));
			} else if (event.key === ' ' && !(target instanceof HTMLButtonElement)) {
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
		gone = true;
		frames?.destroy();
		player?.pause();
		if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		// (what's still running stopped first: its copy of the file is let go after)
		void (async () => {
			if (saving.status === 'working') await cancel(id);
			if (reading) await cancel(`${id}-wave`);
			await release(file);
		})();
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
	/** The parts kept, each as it's cut (for a file each) */
	let pieces = $derived(duration ? keptOf(edit, duration, true) : []);

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
			const { saved, note } = await saveMedia(
				file,
				$state.snapshot(edit),
				duration,
				target,
				video,
				(progress) => (saving.progress = progress),
				id,
				$sizeLimit
			);
			saving = { status: 'done', progress: 1, saved, error: '', note };
			savedEdit();
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
		// (turned, then mirrored as it's seen: the last one in the list is done first)
		return `left: 50%; top: 50%; width: ${w}%; height: ${h}%; transform: translate(-50%, -50%)${edit.mirror ? ' scaleX(-1)' : ''} rotate(${edit.rotate}deg)`;
	});
</script>

{#snippet tools()}
	<div
		class="flex flex-col gap-3 p-3 rounded-2xl bg-white/[0.03] ring-1 ring-white/5 {video
			? 'flex-[1_1_22rem] self-stretch'
			: ''}"
	>
		<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Sound">
			<span class="w-full text-xs font-bold uppercase tracking-wide text-white/55">Sound</span>
			<Dropdown
				label="Fade in"
				prefix="Fade in"
				options={FADES}
				value={edit.fadeIn}
				onchange={(value) => (edit.fadeIn = value)}
			/>
			<Dropdown
				label="Fade out"
				prefix="Fade out"
				options={FADES}
				value={edit.fadeOut}
				onchange={(value) => (edit.fadeOut = value)}
			/>
			<Dropdown
				label="Volume"
				prefix="Volume"
				options={VOLUMES}
				value={edit.volume}
				onchange={(value) => (edit.volume = value)}
			/>
			<Dropdown
				label="Speed"
				prefix="Speed"
				options={SPEEDS}
				value={edit.speed}
				onchange={(value) => (edit.speed = value)}
			/>
			{#if edit.speed !== 1}
				<Toggle
					label="Higher pitch"
					pressed={!edit.keepPitch}
					title="Higher when faster, lower when slower: like a record (nightcore)"
					onclick={() => (edit.keepPitch = !edit.keepPitch)}
				/>
			{/if}
			<Toggle
				label="Even loudness"
				icon="icon-[mingcute--voice-line]"
				pressed={edit.normalize}
				title="As loud as on streaming services"
				onclick={() => (edit.normalize = !edit.normalize)}
			/>
			{#if video}
				<Toggle
					label="No sound"
					icon="icon-[mingcute--volume-off-line]"
					pressed={edit.mute}
					onclick={() => (edit.mute = !edit.mute)}
				/>
			{/if}
		</div>
		{#if video}
			<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Picture">
				<span class="w-full text-xs font-bold uppercase tracking-wide text-white/55">Picture</span>
				<Toggle
					label={edit.rotate ? `Turn · ${edit.rotate}°` : 'Turn'}
					icon="icon-[mingcute--clockwise-line]"
					title="A quarter turn to the right"
					onclick={turn}
				/>
				<Toggle
					label="Mirror"
					icon="icon-[mingcute--flip-horizontal-line]"
					pressed={edit.mirror}
					onclick={() => (edit.mirror = !edit.mirror)}
				/>
				{#if !unplayable}
					<Toggle
						label="Crop"
						icon="icon-[ri--crop-line]"
						pressed={cropping || isCropped(edit.crop)}
						title="Keep a part of the picture: drag it on the video"
						onclick={() => (cropping = !cropping)}
					/>
					{#if cropping}
						<div
							class="h-10 p-1 flex gap-0.5 rounded-lg bg-secondary-300"
							role="radiogroup"
							aria-label="Shape"
							use:radioKeys
						>
							{#each SHAPES as [shapeId, label] (shapeId)}
								<button
									role="radio"
									aria-checked={shape === shapeId}
									tabindex={shape === shapeId ? 0 : -1}
									class="px-2.5 rounded-md text-xs font-bold cursor-pointer transition {shape ===
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
				<Toggle
					label={grabbing ? 'Saving…' : 'Save frame'}
					icon="icon-[mingcute--camera-line]"
					title="This picture as a PNG (turned and cropped as above)"
					disabled={grabbing}
					onclick={grabFrame}
				/>
			</div>
		{/if}
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

<div class="flex flex-col gap-3">
	<!-- What plays -->
	{#if video && !unplayable}
		<div class="flex flex-wrap items-start gap-3">
			<div
				class="flex-[3_1_26rem] min-w-0 grid place-items-center p-2 rounded-2xl bg-black/40 ring-1 ring-white/5 overflow-hidden isolate"
			>
				<CropBox
					width={turned.width}
					height={turned.height}
					bind:crop={edit.crop}
					ratio={ratioOf(shape)}
					active={cropping}
					maxHeight="34vh"
				>
					<!-- svelte-ignore a11y_media_has_caption, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<video
						bind:this={player}
						src={url}
						class="absolute max-w-none object-fill transition-transform duration-200 motion-reduce:transition-none"
						style={videoStyle}
						onloadedmetadata={loaded}
						onerror={unplayableFile}
						onplay={started}
						onpause={() => {
							playing = false;
							cancelAnimationFrame(frame);
						}}
						onclick={toggle}
					></video>
				</CropBox>
			</div>
			{#if duration}
				{@render tools()}
			{/if}
		</div>
	{:else if !video}
		<audio
			bind:this={player}
			src={url}
			onloadedmetadata={() => ready(player.duration)}
			onerror={unplayableFile}
			onplay={started}
			onpause={() => {
				playing = false;
				cancelAnimationFrame(frame);
			}}
		></audio>
	{/if}
	{#if unplayable}
		<p class="flex items-center gap-2 text-sm text-white/50">
			<span class="icon-[mingcute--information-line] size-4"></span>
			Can't be played here: cut it by its times.
		</p>
	{/if}

	{#if duration}
		<!-- Play, where it is, start and end, split, undo -->
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<button
				class="size-10 grid place-items-center rounded-full bg-white text-black hover:bg-white/85 cursor-pointer transition disabled:opacity-40 disabled:cursor-default"
				aria-label={playing ? 'Pause' : 'Play'}
				title="Play (Space)"
				disabled={unplayable}
				onclick={toggle}
			>
				<span
					class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
				></span>
			</button>
			<span class="w-28 tabular-nums">
				<span class="font-semibold" role="timer" aria-label="Where it plays">{clock(time)}</span>
				<span class="text-white/55" title="How long it is, saved" data-length
					><span class="sr-only">Length</span>/ {clock(lengthOf(edit, duration))}</span
				>
			</span>
			{#each MARKS as [which, label, key] (which)}
				<div class="h-10 pl-3 pr-1 flex items-center gap-1 rounded-lg bg-secondary-300">
					<span class="text-white/50">{label}</span>
					<input
						class="w-[4.5rem] h-8 px-1 bg-transparent tabular-nums font-semibold outline-none rounded-md focus:bg-white/10"
						aria-label="{label} time"
						value={clock(edit[which])}
						onchange={(event) => typed(which, event.currentTarget.value)}
					/>
					<button
						class="size-8 grid place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition disabled:opacity-30 disabled:cursor-default"
						aria-label="{label} here"
						title="{label} where it plays now ({key})"
						disabled={unplayable}
						onclick={which === 'start' ? setStart : setEnd}
					>
						<span
							class="{which === 'start'
								? 'icon-[mingcute--arrow-to-left-line]'
								: 'icon-[mingcute--arrow-to-right-line]'} size-4"
						></span>
					</button>
				</div>
			{/each}
			<Toggle
				label="Split"
				icon="icon-[mingcute--scissors-2-line]"
				title="Split where it plays now (S): then take a part out, or save the parts apart"
				onclick={split}
			/>
			<div class="ml-auto flex items-center gap-1 text-white/50">
				<button
					class="size-8 grid place-items-center rounded-full hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-default"
					aria-label="Zoom out"
					title="Zoom out (Ctrl + mouse wheel)"
					disabled={zoom <= 1}
					onclick={() => timeline?.zoomOut()}
				>
					<span class="icon-[mingcute--zoom-out-line] size-4"></span>
				</button>
				<span class="w-9 text-center text-xs tabular-nums"
					>{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</span
				>
				<button
					class="size-8 grid place-items-center rounded-full hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-default"
					aria-label="Zoom in"
					title="Zoom in (Ctrl + mouse wheel)"
					disabled={zoom >= 200}
					onclick={() => timeline?.zoomIn()}
				>
					<span class="icon-[mingcute--zoom-in-line] size-4"></span>
				</button>
				<span class="w-px h-5 mx-1 bg-white/10"></span>
				<Undo {history} />
			</div>
		</div>

		<Timeline
			bind:this={timeline}
			bind:zoom
			{duration}
			bind:start={edit.start}
			bind:end={edit.end}
			{time}
			{wave}
			{reading}
			{frames}
			{parts}
			{playing}
			onseek={seek}
			ontoggle={(from) => togglePart(edit, from)}
			onuncut={(cut) => removeCut(edit, cut)}
		/>

		{#if !video || unplayable}
			{@render tools()}
		{/if}
		{#if frameSaved}
			{@render result([frameSaved])}
		{/if}

		<!-- Saved as -->
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-2xl bg-violet-300/[0.07] ring-1 ring-violet-300/20"
		>
			{#if saving.status === 'working'}
				<span class="pl-1 text-sm font-semibold">Saving…</span>
				<div
					class="flex-1 min-w-40 h-1.5 rounded-full bg-white/10 overflow-hidden"
					role="progressbar"
					aria-label="Saving"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={saving.progress > 0 ? Math.round(saving.progress * 100) : undefined}
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
				<span class="pl-1 text-sm font-semibold text-violet-100">Save as</span>
				<Formats {targets} onpick={save} label="Save as" />
				<div class="ml-auto flex flex-wrap items-center gap-3">
					{#if pieces.length > 1}
						<label class="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								class="accent-violet-400 size-4"
								bind:checked={edit.eachPart}
							/>
							Each of the {pieces.length} parts as its own file
						</label>
					{/if}
					<Dropdown
						label="Size limit"
						icon="icon-[mingcute--arrow-down-line]"
						options={LIMITS}
						value={$sizeLimit}
						onchange={(value) => sizeLimit.set(value)}
					/>
				</div>
			{/if}
		</div>
		{#if saving.status === 'done' && saving.saved.length}
			{@render result(saving.saved)}
			{#if saving.note}
				<p class="-mt-1 flex items-center gap-1.5 text-sm text-amber-200">
					<span class="icon-[mingcute--information-line] size-4"></span>
					{saving.note}
				</p>
			{/if}
		{:else if saving.status === 'failed'}
			<p class="flex items-center gap-1.5 text-sm text-red-300">
				<span class="icon-[mingcute--warning-line] size-4"></span>
				{saving.error}
			</p>
		{/if}
	{:else if failed}
		<p class="flex items-center gap-1.5 text-sm text-red-300">
			<span class="icon-[mingcute--warning-line] size-4"></span>
			{failed}
		</p>
	{:else}
		<p class="text-sm text-white/50">Reading the file…</p>
	{/if}
</div>
