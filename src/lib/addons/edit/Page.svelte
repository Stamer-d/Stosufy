<script>
	// The file editor: one file at a time (dropped, chosen, pasted, or handed over by the
	// converter's "Edit"), a song or video (MediaEditor) or a picture (ImageEditor).
	import { onMount } from 'svelte';
	import { showToast } from '#lib/stores/toast.ts';
	import { installedAddons } from '#lib/addons/store.ts';
	import { detectFormat, kindOf } from '../files/formats.ts';
	import { handOver, takeHandedOver } from '../files/handoff.ts';
	import { nativeFfmpeg } from '../files/native.ts';
	import { pickFiles } from '../files/picked.ts';
	import { outputFolder, reveal } from '../files/save.ts';
	import MediaEditor from './MediaEditor.svelte';
	import ImageEditor from './ImageEditor.svelte';
	import { FOLDER } from './media.ts';

	const EDITABLE = new Set(['image', 'audio', 'video']);

	let input = $state();
	let dragging = $state(0);
	/** The file being edited, and what it is */
	let file = $state(null);
	let kind = $state('');
	/** Each file opened anew (the editor started fresh) */
	let opened = $state(0);
	/** The editor has changes that aren't saved */
	let dirty = $state(false);
	/** Another file, waiting to be opened (said first that the changes would be lost) */
	let waiting = $state(null);

	let canConvert = $derived($installedAddons.some((addon) => addon.id === 'convert'));

	function open(files) {
		const next = [...(files ?? [])].find((candidate) =>
			EDITABLE.has(kindOf(detectFormat(candidate)))
		);
		if (!next) {
			if (files?.length)
				showToast('Songs, videos and pictures can be edited here', 'icon-[mingcute--warning-line]');
			return;
		}
		if (file && dirty) {
			waiting = next;
			return;
		}
		show(next);
	}

	function show(next) {
		waiting = null;
		dirty = false;
		file = next;
		kind = kindOf(detectFormat(next));
		opened++;
	}

	/** The system's file picker (a song or video read where it is), else the page's own */
	async function choose() {
		const files = await pickFiles(false);
		if (files) open(files);
		else input.click();
	}

	async function showFolder() {
		try {
			await reveal(await outputFolder(FOLDER));
		} catch {
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	const hasFiles = (event) => event.dataTransfer?.types?.includes('Files');

	onMount(() => {
		open(takeHandedOver('edit'));
		void nativeFfmpeg();
		const paste = (event) => {
			const target = event.target;
			if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]'))
				return;
			if (event.clipboardData?.files?.length) {
				event.preventDefault();
				open(event.clipboardData.files);
			}
		};
		window.addEventListener('paste', paste);
		return () => window.removeEventListener('paste', paste);
	});
</script>

<div
	class="relative min-h-full pb-12"
	role="region"
	aria-label="File editor"
	ondragenter={(event) => hasFiles(event) && dragging++}
	ondragleave={() => (dragging = Math.max(0, dragging - 1))}
	ondragover={(event) => hasFiles(event) && event.preventDefault()}
	ondrop={(event) => {
		event.preventDefault();
		dragging = 0;
		open(event.dataTransfer?.files);
	}}
>
	<input
		bind:this={input}
		type="file"
		accept="audio/*,video/*,image/*,.mkv,.flac,.opus,.wma,.avi,.ico,.tif,.tiff"
		class="hidden"
		aria-label="Choose a file"
		onchange={(event) => {
			open(event.currentTarget.files);
			event.currentTarget.value = '';
		}}
	/>

	<!-- Header -->
	<div class="relative overflow-hidden">
		<div
			class="absolute inset-0 opacity-60"
			style="background: linear-gradient(120deg, #8b5cf6, #ec4899 55%, transparent)"
		></div>
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent"></div>
		<div class="relative px-8 pt-7 pb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
			<div class="min-w-0">
				<h1 class="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
					<span class="icon-[mingcute--scissors-line] size-8"></span>File editor
				</h1>
				<p class="mt-1 text-sm text-white/70">
					Cut, fade and turn songs, videos and pictures. It stays on your computer.
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if file}
					{#if canConvert}
						<button
							class="h-9 px-3 flex items-center gap-1.5 rounded-full bg-black/25 hover:bg-black/40 text-sm font-semibold cursor-pointer transition"
							title="Convert it as it is, in the file converter"
							onclick={() => handOver('convert', [file])}
						>
							<span class="icon-[mingcute--transfer-line] size-4 text-white/70"></span>
							Convert instead
						</button>
					{/if}
					<button
						class="h-9 px-3 flex items-center gap-1.5 rounded-full bg-black/25 hover:bg-black/40 text-sm font-semibold cursor-pointer transition"
						onclick={choose}
					>
						<span class="icon-[mingcute--file-new-line] size-4 text-white/70"></span>
						Other file
					</button>
				{/if}
				<button
					class="h-9 px-3 flex items-center gap-1.5 rounded-full bg-black/25 hover:bg-black/40 text-sm font-semibold cursor-pointer transition"
					title="Where the edited files are: Stosufy/Edited"
					onclick={showFolder}
				>
					<span class="icon-[mingcute--folder-open-line] size-4 text-white/70"></span>
					Open folder
				</button>
			</div>
		</div>
	</div>

	<div class="px-8">
		{#if !file}
			<button
				class="group w-full h-72 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition {dragging
					? 'border-violet-300 bg-violet-300/10'
					: 'border-white/15 hover:border-white/30 hover:bg-white/[0.03]'}"
				onclick={choose}
			>
				<span
					class="size-16 grid place-items-center rounded-2xl bg-white/[0.06] group-hover:bg-white/10 transition"
				>
					<span class="icon-[mingcute--scissors-line] size-8 text-white/80"></span>
				</span>
				<span class="text-xl font-bold">Drop a song, a video or a picture</span>
				<span class="text-sm text-secondary-600"
					>or click to choose one · or paste it with Ctrl+V</span
				>
			</button>
		{:else}
			<div class="mb-4 flex items-center gap-2 min-w-0">
				<span
					class="{kind === 'image'
						? 'icon-[mingcute--pic-line] text-amber-300'
						: kind === 'video'
							? 'icon-[mingcute--video-line] text-rose-300'
							: 'icon-[mingcute--music-2-line] text-sky-300'} size-5 shrink-0"
				></span>
				<h2 class="truncate text-lg font-bold" title={file.name}>{file.name}</h2>
			</div>
			{#if waiting}
				<div
					class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 pl-4 rounded-2xl bg-amber-300/10 ring-1 ring-amber-300/30 text-sm"
					role="alertdialog"
					aria-label="Changes not saved"
				>
					<span class="icon-[mingcute--warning-line] size-5 text-amber-200 shrink-0"></span>
					<span class="min-w-0 flex-1">
						The changes to <b class="font-semibold">{file.name}</b> aren't saved yet.
					</span>
					<button
						class="h-8 px-3 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
						onclick={() => (waiting = null)}
					>
						Keep editing
					</button>
					<button
						class="h-8 px-3 rounded-full font-semibold bg-amber-300 text-black hover:bg-amber-200 cursor-pointer transition"
						onclick={() => show(waiting)}
					>
						Open {waiting.name} anyway
					</button>
				</div>
			{/if}
			{#key opened}
				{#if kind === 'image'}
					<ImageEditor {file} bind:dirty />
				{:else}
					<MediaEditor
						{file}
						video={kind === 'video'}
						bind:dirty
						onkind={(found) => (kind = found)}
					/>
				{/if}
			{/key}
		{/if}
	</div>

	{#if dragging && file}
		<div
			class="pointer-events-none fixed inset-0 z-30 grid place-items-center bg-black/40 backdrop-blur-[2px]"
		>
			<div
				class="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl bg-panel/90 ring-2 ring-violet-300/60"
			>
				<span class="icon-[mingcute--scissors-line] size-12 text-violet-300"></span>
				<p class="text-lg font-bold">Drop to edit it instead</p>
			</div>
		</div>
	{/if}
</div>
