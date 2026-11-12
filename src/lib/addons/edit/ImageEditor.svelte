<script>
	// A picture being edited: turned, mirrored, cut to a part (dragged, maybe in a shape like
	// square or 16:9), made smaller, and saved in a format.
	import { onDestroy } from 'svelte';
	import { showToast } from '#lib/stores/toast.ts';
	import { detectFormat, editTargets, extensionOf } from '../files/formats.ts';
	import { readImage } from '../files/image.ts';
	import { reveal } from '../files/save.ts';
	import Formats from '../files/Formats.svelte';
	import CopyButton from '../files/CopyButton.svelte';
	import Dropdown from '../files/Dropdown.svelte';
	import Toggle from '../files/Toggle.svelte';
	import { sizeText } from '../files/size.ts';
	import { LIMITS, sizeLimit } from './limit.ts';
	import { dragOut } from '../files/dragout.ts';
	import { onMount } from 'svelte';
	import { cssFilter, freshImageEdit, oriented, outputSize, saveImage } from './image.ts';
	import { SHAPES, biggest, ratioOf } from './crop.ts';
	import { createHistory } from './history.svelte.ts';
	import CropBox from './CropBox.svelte';
	import Undo from './Undo.svelte';

	/** @type {{ file: File, dirty?: boolean }} */
	let { file, dirty = $bindable(false) } = $props();

	// (a file of its own each time: the page makes a new editor for another file)
	// svelte-ignore state_referenced_locally
	const targets = editTargets(detectFormat(file));
	let image = $state(null);
	let failed = $state('');
	let edit = $state(freshImageEdit());
	let shape = $state('free');
	let preview = $state('');
	/** @type {[('brightness' | 'contrast' | 'saturation'), string, string][]} */
	const ADJUSTMENTS = [
		['brightness', 'Light', 'icon-[mingcute--sun-line]'],
		['contrast', 'Contrast', 'icon-[ri--contrast-2-line]'],
		['saturation', 'Colour', 'icon-[mingcute--drop-line]']
	];

	const history = createHistory((value) => (edit = value));
	$effect(() => history.changed($state.snapshot(edit)));
	onMount(() => {
		const keys = (event) => history.key(event);
		window.addEventListener('keydown', keys);
		return () => window.removeEventListener('keydown', keys);
	});
	/** @type {{ status: string, saved: any, error: string, note?: string }} */
	let saving = $state({ status: 'idle', saved: null, error: '' });
	/** What it was when it was opened or last saved (to say when there's something to lose) */
	let lastSaved = $state(JSON.stringify(freshImageEdit()));
	$effect(() => {
		dirty = JSON.stringify(edit) !== lastSaved;
	});

	// svelte-ignore state_referenced_locally
	readImage(file, extensionOf(file.name))
		.then((read) => (image = read))
		.catch((error) => (failed = error?.message ?? "Couldn't read the picture"));

	// The turned and mirrored picture, to cut from
	$effect(() => {
		if (!image) return;
		// (only the turn and the mirrors: not drawn again for each move of the part; as big as
		// it can be shown, not a camera's 6000 px)
		const canvas = oriented(
			image,
			{
				...freshImageEdit(),
				turns: edit.turns,
				mirrorX: edit.mirrorX,
				mirrorY: edit.mirrorY
			},
			2048
		);
		let url = '';
		let current = true;
		canvas.toBlob((blob) => {
			if (!current || !blob) return;
			url = URL.createObjectURL(blob);
			preview = url;
		});
		return () => {
			current = false;
			if (url) setTimeout(() => URL.revokeObjectURL(url), 500);
		};
	});

	onDestroy(() => {
		if (preview) URL.revokeObjectURL(preview);
	});

	/** The turned picture's size (px) */
	let whole = $derived.by(() => {
		if (!image) return { width: 1, height: 1 };
		const sideways = edit.turns % 2 === 1;
		return sideways
			? { width: image.naturalHeight, height: image.naturalWidth }
			: { width: image.naturalWidth, height: image.naturalHeight };
	});
	let size = $derived(image ? outputSize(image, edit) : { width: 0, height: 0 });
	let ratio = $derived(ratioOf(shape));

	function turn(by) {
		edit.turns = /** @type {0|1|2|3} */ ((edit.turns + by + 4) % 4);
		edit.crop = { x: 0, y: 0, w: 1, h: 1 };
		if (ratio) chooseShape(shape);
	}

	/** The biggest part of this shape, in the middle */
	function chooseShape(id) {
		shape = id;
		const wanted = ratioOf(id);
		if (wanted) edit.crop = biggest(wanted, whole.width, whole.height);
	}

	function reset() {
		edit = freshImageEdit();
		shape = 'free';
	}

	async function save(targetId) {
		const target = targets.find((option) => option.id === targetId);
		if (!target || !image) return;
		saving = { status: 'working', saved: null, error: '' };
		try {
			const limit = $sizeLimit;
			const saved = await saveImage(file, image, $state.snapshot(edit), target, limit);
			const note =
				limit && saved.size > limit ? `Couldn't get it under ${sizeText(limit)}` : undefined;
			saving = { status: 'done', saved, error: '', note };
			lastSaved = JSON.stringify($state.snapshot(edit));
		} catch (error) {
			console.warn('Could not save the picture:', error);
			saving = { status: 'failed', saved: null, error: error?.message ?? String(error) };
		}
	}

	async function show(path) {
		try {
			await reveal(path);
		} catch {
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	let cropped = $derived(edit.crop.w < 0.999 || edit.crop.h < 0.999);
	let adjusted = $derived(!!(edit.brightness || edit.contrast || edit.saturation));
</script>

{#if failed}
	<p class="flex items-center gap-1.5 text-sm text-red-300">
		<span class="icon-[mingcute--warning-line] size-4"></span>{failed}
	</p>
{:else if !image}
	<p class="text-sm text-white/50">Reading the picture…</p>
{:else}
	<div class="flex flex-col gap-3">
		<!-- The picture, and the part kept -->
		<div
			class="grid place-items-center p-2 rounded-2xl bg-black/40 ring-1 ring-white/5 overflow-hidden isolate"
		>
			<CropBox
				width={whole.width}
				height={whole.height}
				bind:crop={edit.crop}
				{ratio}
				maxHeight="40vh"
			>
				{#if preview}
					<img
						src={preview}
						alt=""
						class="absolute inset-0 size-full"
						style="filter: {cssFilter(edit)}"
						draggable="false"
					/>
				{/if}
			</CropBox>
		</div>

		<!-- What's done to it -->
		<div class="flex flex-col gap-2 p-3 rounded-2xl bg-white/[0.03] ring-1 ring-white/5">
			<div class="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Picture">
				<span class="w-16 text-xs font-bold uppercase tracking-wide text-white/40">Picture</span>
				<Toggle
					label="Turn left"
					icon="icon-[mingcute--anticlockwise-line]"
					onclick={() => turn(-1)}
				/>
				<Toggle label="Turn right" icon="icon-[mingcute--clockwise-line]" onclick={() => turn(1)} />
				<Toggle
					label="Mirror"
					icon="icon-[mingcute--flip-horizontal-line]"
					pressed={edit.mirrorX}
					onclick={() => (edit.mirrorX = !edit.mirrorX)}
				/>
				<Toggle
					label="Upside down"
					icon="icon-[mingcute--flip-vertical-line]"
					pressed={edit.mirrorY}
					onclick={() => (edit.mirrorY = !edit.mirrorY)}
				/>
				<div
					class="h-10 p-1 flex items-center gap-0.5 rounded-xl bg-black/30"
					role="radiogroup"
					aria-label="Shape"
					title="Crop: drag on the picture, or choose a shape"
				>
					<span class="icon-[ri--crop-line] size-4 mx-1.5 text-white/50"></span>
					{#each SHAPES as [id, label] (id)}
						<button
							role="radio"
							aria-checked={shape === id}
							class="h-full px-2.5 rounded-lg text-xs font-bold cursor-pointer transition {shape ===
							id
								? 'bg-white text-black'
								: 'text-white/70 hover:text-white'}"
							onclick={() => chooseShape(id)}
						>
							{label}
						</button>
					{/each}
				</div>
				<div class="h-10 pl-3 pr-2 flex items-center gap-1 rounded-xl bg-white/[0.07]">
					<span class="text-white/50">Width</span>
					<input
						type="number"
						min="1"
						class="w-16 h-8 px-1 bg-transparent tabular-nums font-semibold outline-none rounded-md focus:bg-white/10 [appearance:textfield]"
						aria-label="Width"
						placeholder="Full"
						value={edit.width || ''}
						onchange={(event) =>
							(edit.width = Math.max(0, Math.round(+event.currentTarget.value || 0)))}
					/>
					<span class="tabular-nums text-white/40">{size.width} × {size.height} px</span>
				</div>
				<div class="ml-auto flex items-center gap-1">
					{#if cropped || adjusted || edit.turns || edit.mirrorX || edit.mirrorY || edit.width}
						<button
							class="h-8 px-3 rounded-full font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition"
							onclick={reset}
						>
							Reset
						</button>
					{/if}
					<Undo {history} />
				</div>
			</div>
			<div
				class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
				role="group"
				aria-label="Adjust"
			>
				<span class="w-16 text-xs font-bold uppercase tracking-wide text-white/40">Adjust</span>
				{#each ADJUSTMENTS as [key, label, icon] (key)}
					<label class="flex items-center gap-2" title="Double-click: back to 0">
						<span class="{icon} size-4 text-white/50"></span>
						<span class="text-white/60">{label}</span>
						<input
							type="range"
							min="-100"
							max="100"
							step="1"
							class="w-28 accent-violet-300"
							aria-label={label}
							bind:value={edit[key]}
							ondblclick={() => (edit[key] = 0)}
						/>
						<span class="w-8 tabular-nums text-right text-white/50">
							{edit[key] > 0 ? '+' : ''}{edit[key]}
						</span>
					</label>
				{/each}
			</div>
		</div>

		<!-- Saved as -->
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-2xl bg-violet-300/[0.07] ring-1 ring-violet-300/20"
		>
			<span class="pl-1 text-sm font-semibold text-violet-100">
				{saving.status === 'working' ? 'Saving…' : 'Save as'}
			</span>
			<Formats {targets} onpick={save} label="Save as" disabled={saving.status === 'working'} />
			<div class="ml-auto">
				<Dropdown
					label="Size limit"
					icon="icon-[mingcute--arrow-down-line]"
					options={LIMITS}
					value={$sizeLimit}
					onchange={(value) => sizeLimit.set(value)}
				/>
			</div>
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
	</div>
{/if}
