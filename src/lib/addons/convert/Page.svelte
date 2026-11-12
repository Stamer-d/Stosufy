<script>
	// The file converter: files in (dropped, chosen or pasted), one click on what each is to
	// become, and it's converted and saved to ~/Stosufy/Converted (see jobs.ts).
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { showToast } from '#lib/stores/toast.ts';
	import { installedAddons } from '#lib/addons/store.ts';
	import { reveal as revealFile } from '../files/save.ts';
	import { handOver, takeHandedOver } from '../files/handoff.ts';
	import CopyButton from '../files/CopyButton.svelte';
	import { dragOut } from '../files/dragout.ts';
	import { pickFiles } from '../files/picked.ts';
	import { nativeState, nativeFfmpeg, retryNative } from '../files/native.ts';
	import {
		jobs,
		options,
		addFiles,
		convertTo,
		convertAllTo,
		retry,
		chooseAgain,
		stopJob,
		removeJob,
		clearJobs,
		converterFolder,
		saveAllAsZip
	} from './jobs.ts';

	/** How many formats are buttons; the rest are under "More" */
	const QUICK = 5;
	const KINDS = {
		image: { plural: 'pictures', icon: 'icon-[mingcute--pic-line]', tint: 'text-amber-300' },
		audio: { plural: 'sound files', icon: 'icon-[mingcute--music-2-line]', tint: 'text-sky-300' },
		video: { plural: 'videos', icon: 'icon-[mingcute--video-line]', tint: 'text-rose-300' },
		data: { plural: 'data files', icon: 'icon-[mingcute--braces-line]', tint: 'text-emerald-300' },
		text: { plural: 'texts', icon: 'icon-[mingcute--text-line]', tint: 'text-violet-300' },
		archive: {
			plural: 'archives',
			icon: 'icon-[mingcute--file-zip-line]',
			tint: 'text-orange-300'
		},
		other: { plural: 'files', icon: 'icon-[mingcute--file-line]', tint: 'text-white/60' }
	};
	const EXAMPLES = [
		'MP4 → MP3',
		'PNG → JPG',
		'MOV → MP4',
		'WAV → MP3',
		'Video → GIF',
		'JSON → CSV'
	];
	/** @type {[import('../files/presets.ts').Quality, string][]} */
	const QUALITIES = [
		['small', 'Small files'],
		['balanced', 'Balanced'],
		['best', 'Best quality']
	];
	const MB = 1024 * 1024;
	const LIMITS = [
		[0, 'Any size'],
		[8 * MB, 'Up to 8 MB'],
		[10 * MB, 'Up to 10 MB (Discord)'],
		[25 * MB, 'Up to 25 MB'],
		[50 * MB, 'Up to 50 MB'],
		[100 * MB, 'Up to 100 MB']
	];
	const EDITABLE = new Set(['image', 'audio', 'video']);

	let input = $state();
	let dragging = $state(0);
	let zipping = $state(false);

	let busy = $derived($jobs.some((job) => job.status === 'working' || job.status === 'waiting'));
	let waiting = $derived($jobs.filter((job) => job.status === 'ready'));
	let savedCount = $derived($jobs.reduce((sum, job) => sum + job.saved.length, 0));
	/** What several files not converted yet, all of one kind, can all become (for "All to") */
	let common = $derived.by(() => {
		if (waiting.length < 2 || waiting.some((job) => job.kind !== waiting[0].kind)) return [];
		return waiting[0].targets.filter(
			(target) =>
				target.group !== 'Any file' &&
				waiting.every((job) => job.targets.some((other) => other.id === target.id))
		);
	});

	let canEdit = $derived($installedAddons.some((addon) => addon.id === 'edit'));

	const soundOnly = (target) => target.group === 'Only the sound';
	const smaller = (target) => target.group === 'Smaller';
	const titleOf = (target) =>
		soundOnly(target)
			? `Only the sound, as ${target.label}`
			: smaller(target)
				? `A smaller ${target.label}`
				: target.id === 'unzip'
					? 'Unpack the files in it'
					: target.id === 'base64'
						? 'As Base64 text'
						: `As ${target.label}`;

	function size(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB'];
		let value = bytes / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
	}

	function add(files) {
		if (files?.length) addFiles(files);
	}

	/** The system's file picker (songs and videos read where they are), else the page's own */
	async function choose() {
		const files = await pickFiles(true);
		if (files) add(files);
		else input.click();
	}

	async function reveal(path) {
		try {
			await revealFile(path ?? (await converterFolder()));
		} catch (error) {
			console.error('Could not show the folder:', error);
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	async function zipAll() {
		zipping = true;
		try {
			const path = await saveAllAsZip();
			showToast('Saved as one ZIP', 'icon-[mingcute--file-zip-line]');
			reveal(path);
		} catch (error) {
			console.error('Could not make the ZIP:', error);
			showToast("Couldn't make the ZIP", 'icon-[mingcute--warning-line]');
		} finally {
			zipping = false;
		}
	}

	const hasFiles = (event) => event.dataTransfer?.types?.includes('Files');

	onMount(() => {
		// Files handed over (from the editor), and the fast FFmpeg got ready in the background
		add(takeHandedOver('convert'));
		void nativeFfmpeg();
		// Files pasted (copied in the file manager) are added too
		const paste = (event) => {
			const target = event.target;
			if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]'))
				return;
			if (event.clipboardData?.files?.length) {
				event.preventDefault();
				add(event.clipboardData.files);
			}
		};
		window.addEventListener('paste', paste);
		return () => window.removeEventListener('paste', paste);
	});
</script>

{#snippet formats(targets, onpick, label)}
	<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
		{#each targets.slice(0, QUICK) as target (target.id)}
			<button
				class="h-8 px-3 flex items-center gap-1.5 rounded-full text-sm font-bold bg-white/[0.08] hover:bg-white hover:text-black cursor-pointer transition"
				title={titleOf(target)}
				data-target={target.id}
				onclick={() => onpick(target.id)}
			>
				{#if soundOnly(target)}
					<span class="icon-[mingcute--music-2-line] size-3.5 opacity-70"></span>
				{:else if smaller(target)}
					<span class="icon-[mingcute--arrow-down-line] size-3.5 opacity-70"></span>
				{/if}
				{smaller(target) ? `Smaller ${target.label}` : target.label}
			</button>
		{/each}
		{#if targets.length > QUICK}
			<label
				class="relative h-8 pl-3 pr-2 flex items-center gap-1 rounded-full text-sm font-semibold text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition"
			>
				More
				<span class="icon-[mingcute--down-line] size-3.5"></span>
				<select
					class="absolute inset-0 opacity-0 cursor-pointer"
					aria-label="More formats"
					value=""
					onchange={(event) => {
						const value = event.currentTarget.value;
						event.currentTarget.value = '';
						if (value) onpick(value);
					}}
				>
					<option value="" disabled>More formats</option>
					{#each targets.slice(QUICK) as target (target.id)}
						<option value={target.id} class="bg-panel">{titleOf(target).replace(/^As /, '')}</option
						>
					{/each}
				</select>
			</label>
		{/if}
	</div>
{/snippet}

<div
	class="relative min-h-full pb-12"
	role="region"
	aria-label="File converter"
	ondragenter={(event) => hasFiles(event) && dragging++}
	ondragleave={() => (dragging = Math.max(0, dragging - 1))}
	ondragover={(event) => hasFiles(event) && event.preventDefault()}
	ondrop={(event) => {
		event.preventDefault();
		dragging = 0;
		add(event.dataTransfer?.files);
	}}
>
	<input
		bind:this={input}
		type="file"
		multiple
		class="hidden"
		aria-label="Choose files"
		onchange={(event) => {
			add(event.currentTarget.files);
			event.currentTarget.value = '';
		}}
	/>

	<!-- Header -->
	<div class="relative overflow-hidden">
		<div
			class="absolute inset-0 opacity-60"
			style="background: linear-gradient(120deg, #f59e0b, #ef4444 55%, transparent)"
		></div>
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent"></div>
		<div class="relative px-8 pt-9 pb-5 flex flex-wrap items-end justify-between gap-4">
			<div>
				<h1 class="flex items-center gap-3 text-4xl font-extrabold tracking-tight">
					<span class="icon-[mingcute--transfer-line] size-9"></span>File converter
				</h1>
				<p class="mt-1.5 text-white/75">
					Drop a file, click the format you want. It stays on your computer.
				</p>
				{#if $nativeState.status === 'downloading'}
					<p class="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-200/90">
						<span class="icon-[mingcute--flash-line] size-3.5"></span>
						Getting the fast converter ready… {Math.round($nativeState.progress * 100)}%
					</p>
				{:else if $nativeState.status === 'failed'}
					<p class="mt-2 flex items-center gap-1.5 text-xs text-white/60">
						<span class="icon-[mingcute--warning-line] size-3.5"></span>
						Sound and video convert slower: the fast converter couldn't be downloaded.
						<button class="font-semibold underline cursor-pointer" onclick={retryNative}>
							Try again
						</button>
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<label
					class="relative h-9 pl-3 pr-2 flex items-center gap-1.5 rounded-full text-sm cursor-pointer transition {$options.maxBytes
						? 'bg-amber-300 text-black'
						: 'bg-black/25 hover:bg-black/40'}"
					title="Make every file smaller than this (sound, video, pictures)"
				>
					<span class="icon-[mingcute--arrow-down-line] size-4 opacity-70"></span>
					<span class="font-semibold">
						{LIMITS.find(([bytes]) => bytes === $options.maxBytes)?.[1] ??
							`Up to ${size($options.maxBytes)}`}
					</span>
					<span class="icon-[mingcute--down-line] size-3.5 opacity-60"></span>
					<select
						class="absolute inset-0 opacity-0 cursor-pointer"
						aria-label="Size limit"
						bind:value={$options.maxBytes}
					>
						{#each LIMITS as [bytes, label] (bytes)}
							<option value={bytes} class="bg-panel text-white">{label}</option>
						{/each}
					</select>
				</label>
				<label
					class="relative h-9 pl-3 pr-2 flex items-center gap-1.5 rounded-full bg-black/25 hover:bg-black/40 text-sm cursor-pointer transition"
					title="Smaller files or better quality (sound, video, JPG, WebP)"
				>
					<span class="icon-[mingcute--settings-3-line] size-4 text-white/70"></span>
					<span class="font-semibold">
						{QUALITIES.find(([id]) => id === $options.quality)?.[1]}
					</span>
					<span class="icon-[mingcute--down-line] size-3.5 text-white/60"></span>
					<select
						class="absolute inset-0 opacity-0 cursor-pointer"
						aria-label="Quality"
						bind:value={$options.quality}
					>
						{#each QUALITIES as [id, label] (id)}
							<option value={id} class="bg-panel">{label}</option>
						{/each}
					</select>
				</label>
				<button
					class="h-9 px-3 flex items-center gap-1.5 rounded-full bg-black/25 hover:bg-black/40 text-sm font-semibold cursor-pointer transition"
					title="Where the converted files are: Stosufy/Converted"
					onclick={() => reveal()}
				>
					<span class="icon-[mingcute--folder-open-line] size-4 text-white/70"></span>
					Open folder
				</button>
			</div>
		</div>
	</div>

	<div class="px-8 flex flex-col gap-4">
		{#if !$jobs.length}
			<!-- Nothing yet: where files go in -->
			<button
				class="group h-72 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition {dragging
					? 'border-amber-300 bg-amber-300/10'
					: 'border-white/15 hover:border-white/30 hover:bg-white/[0.03]'}"
				onclick={choose}
			>
				<span
					class="size-16 grid place-items-center rounded-2xl bg-white/[0.06] group-hover:bg-white/10 transition"
				>
					<span class="icon-[mingcute--upload-2-line] size-8 text-white/80"></span>
				</span>
				<span class="text-xl font-bold">Drop files here</span>
				<span class="text-sm text-secondary-600"
					>or click to choose them · or paste with Ctrl+V</span
				>
				<span class="mt-2 flex flex-wrap justify-center gap-1.5 px-6">
					{#each EXAMPLES as example (example)}
						<span
							class="px-2.5 h-6 grid place-items-center rounded-full bg-white/[0.05] text-xs font-semibold text-white/50"
						>
							{example}
						</span>
					{/each}
					<span class="px-1 h-6 grid place-items-center text-xs font-semibold text-white/40">
						and many more
					</span>
				</span>
			</button>
		{:else}
			<!-- Several waiting: all at once -->
			{#if common.length}
				<div
					class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 pl-4 rounded-xl bg-amber-300/[0.07] ring-1 ring-amber-300/20"
					transition:fade={{ duration: 120 }}
				>
					<span class="text-sm font-semibold text-amber-100"
						>All {waiting.length} {KINDS[waiting[0].kind].plural} to</span
					>
					{@render formats(common, convertAllTo, 'All files to')}
				</div>
			{/if}

			<!-- The files -->
			<ul class="flex flex-col gap-2" aria-label="Files">
				{#each $jobs as job (job.id)}
					{@const kind = KINDS[job.kind]}
					{@const target = job.targets.find((option) => option.id === job.target)}
					<li
						in:fly={{ y: 8, duration: 180 }}
						class="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 rounded-xl bg-white/[0.04] ring-1 ring-white/5"
						aria-label={job.file.name}
						data-status={job.status}
					>
						<div class="min-w-0 flex-1 basis-56 flex items-center gap-3">
							<div
								class="size-11 shrink-0 grid place-items-center rounded-lg bg-black/30 overflow-hidden"
							>
								{#if job.preview}
									<img src={job.preview} alt="" class="size-full object-cover" />
								{:else}
									<span class="{kind.icon} size-5 {kind.tint}"></span>
								{/if}
							</div>
							<div class="min-w-0">
								<p class="truncate font-semibold" title={job.file.name}>{job.file.name}</p>
								<p class="text-xs text-secondary-600">
									{job.format?.label ?? 'File'} · {size(job.file.size)}
								</p>
							</div>
						</div>

						<div class="flex items-center gap-2 text-sm">
							{#if job.status === 'ready'}
								{@render formats(
									job.targets,
									(id) => convertTo(job.id, id),
									`Convert ${job.file.name} to`
								)}
							{:else if job.status === 'waiting' || job.status === 'working'}
								<span class="font-semibold text-white/70">
									{target && soundOnly(target)
										? 'Sound to'
										: target && smaller(target)
											? 'Smaller'
											: 'To'}
									{target?.label}
								</span>
								<div
									class="w-40 h-1.5 rounded-full bg-white/10 overflow-hidden"
									role="progressbar"
									aria-valuenow={Math.round(job.progress * 100)}
								>
									{#if job.progress > 0}
										<div
											class="h-full rounded-full bg-amber-300 transition-[width]"
											style="width: {job.progress * 100}%"
										></div>
									{:else if job.status === 'working'}
										<div class="h-full w-full rounded-full bg-amber-300/50 animate-pulse"></div>
									{/if}
								</div>
								<span class="w-10 text-right tabular-nums text-white/60">
									{job.status === 'waiting'
										? ''
										: job.progress > 0
											? `${Math.round(job.progress * 100)}%`
											: '…'}
								</span>
							{:else if job.status === 'done'}
								<button
									class="h-8 pl-2.5 pr-3 flex items-center gap-1.5 rounded-full font-semibold text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 cursor-pointer transition"
									title="Drag it out into a chat or a folder, or click to show it in its folder"
									use:dragOut={job.saved.map((file) => file.path)}
									onclick={() => reveal(job.saved[0]?.path)}
								>
									<span class="icon-[mingcute--check-circle-fill] size-4"></span>
									<span class="max-w-56 truncate">
										{job.saved.length === 1
											? job.saved[0].name.split('/').pop()
											: `${job.saved.length} files`}
									</span>
									<span class="text-emerald-300/60 font-medium">
										{size(job.saved.reduce((sum, file) => sum + file.size, 0))}
									</span>
								</button>
								<CopyButton files={job.saved} />
								<button
									class="h-8 px-3 rounded-full font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition"
									onclick={() => chooseAgain(job.id)}
								>
									Other format
								</button>
							{:else if job.status === 'failed'}
								<span class="max-w-80 flex items-center gap-1.5 text-red-300" title={job.error}>
									<span class="icon-[mingcute--warning-line] size-4 shrink-0"></span>
									<span class="line-clamp-2">{job.error}</span>
								</span>
								<button
									class="h-8 px-3 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
									onclick={() => retry(job.id)}
								>
									Try again
								</button>
								<button
									class="h-8 px-3 rounded-full font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition"
									onclick={() => chooseAgain(job.id)}
								>
									Other format
								</button>
							{/if}
							{#if canEdit && EDITABLE.has(job.kind) && job.status !== 'working' && job.status !== 'waiting'}
								<button
									class="size-8 grid place-items-center rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition"
									aria-label="Edit {job.file.name}"
									title="Edit it: cut, turn, fade, …"
									onclick={() => handOver('edit', [job.file])}
								>
									<span class="icon-[mingcute--scissors-line] size-4"></span>
								</button>
							{/if}
							{#if job.status === 'working' || job.status === 'waiting'}
								<button
									class="size-8 grid place-items-center rounded-full text-white/40 hover:text-white hover:bg-white/10 cursor-pointer transition"
									aria-label="Stop {job.file.name}"
									title="Stop"
									onclick={() => stopJob(job.id)}
								>
									<span class="icon-[mingcute--stop-circle-line] size-4"></span>
								</button>
							{:else}
								<button
									class="size-8 grid place-items-center rounded-full text-white/40 hover:text-white hover:bg-white/10 cursor-pointer transition"
									aria-label="Remove {job.file.name}"
									onclick={() => removeJob(job.id)}
								>
									<span class="icon-[mingcute--close-line] size-4"></span>
								</button>
							{/if}
						</div>
						{#if job.status === 'done' && job.note}
							<p class="basis-full pl-14 flex items-center gap-1.5 text-xs text-amber-200/90">
								<span class="icon-[mingcute--information-line] size-3.5"></span>
								{job.note}
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			<div class="flex flex-wrap items-center gap-2">
				<button
					class="h-9 px-4 flex items-center gap-2 rounded-full text-sm font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
					onclick={choose}
				>
					<span class="icon-[mingcute--add-line] size-4"></span>
					Add files
				</button>
				{#if savedCount > 1}
					<button
						class="h-9 px-4 flex items-center gap-2 rounded-full text-sm font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition disabled:opacity-50 disabled:cursor-default"
						disabled={zipping || busy}
						onclick={zipAll}
					>
						<span class="icon-[mingcute--file-zip-line] size-4"></span>
						All as one ZIP
					</button>
				{/if}
				<button
					class="ml-auto h-9 px-4 rounded-full text-sm font-semibold text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition"
					onclick={clearJobs}
				>
					Clear the list
				</button>
			</div>
		{/if}
	</div>

	{#if dragging && $jobs.length}
		<div
			class="pointer-events-none fixed inset-0 z-30 grid place-items-center bg-black/40 backdrop-blur-[2px]"
			transition:fade={{ duration: 100 }}
		>
			<div
				class="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl bg-panel/90 ring-2 ring-amber-300/60"
			>
				<span class="icon-[mingcute--upload-2-line] size-12 text-amber-300"></span>
				<p class="text-lg font-bold">Drop to add them</p>
			</div>
		</div>
	{/if}
</div>
