<script>
	// The file converter: files dropped in (or chosen), what each is to become, converted one
	// after the other and saved to ~/Stosufy/Converted (see jobs.ts).
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { showToast } from '#lib/stores/toast.ts';
	import {
		jobs,
		options,
		addFiles,
		setTarget,
		setTargetForAll,
		removeJob,
		clearJobs,
		convert,
		outputFolder,
		saveAllAsZip
	} from './jobs.ts';

	const KINDS = {
		image: { icon: 'icon-[mingcute--pic-line]', label: 'pictures', tint: 'text-amber-300' },
		audio: { icon: 'icon-[mingcute--music-2-line]', label: 'sounds', tint: 'text-sky-300' },
		video: { icon: 'icon-[mingcute--video-line]', label: 'videos', tint: 'text-rose-300' },
		data: { icon: 'icon-[mingcute--braces-line]', label: 'data files', tint: 'text-emerald-300' },
		text: { icon: 'icon-[mingcute--text-line]', label: 'texts', tint: 'text-violet-300' },
		archive: { icon: 'icon-[mingcute--file-zip-line]', label: 'archives', tint: 'text-orange-300' },
		other: { icon: 'icon-[mingcute--file-line]', label: 'other files', tint: 'text-white/60' }
	};
	/** @type {[import('./media.ts').Quality, string][]} */
	const QUALITIES = [
		['small', 'Small'],
		['balanced', 'Balanced'],
		['best', 'Best']
	];
	const IMAGE_SIZES = [
		[0, 'Pictures at full size'],
		[4096, 'Pictures up to 4096 px'],
		[2048, 'Pictures up to 2048 px'],
		[1024, 'Pictures up to 1024 px'],
		[512, 'Pictures up to 512 px']
	];
	const VIDEO_HEIGHTS = [
		[0, 'Videos at full size'],
		[1080, 'Videos up to 1080p'],
		[720, 'Videos up to 720p'],
		[480, 'Videos up to 480p']
	];

	let input = $state();
	let dragging = $state(0);

	let ready = $derived($jobs.filter((job) => job.status === 'ready' || job.status === 'failed'));
	let working = $derived($jobs.some((job) => job.status === 'working' || job.status === 'waiting'));
	let finished = $derived($jobs.filter((job) => job.status === 'done'));
	let savedCount = $derived(finished.reduce((sum, job) => sum + job.saved.length, 0));
	let hasKind = $derived(new Set($jobs.map((job) => job.kind)));
	/** Kinds with more than one file, each with what all of them can become */
	let groups = $derived(
		/** @type {import('./formats.ts').Kind[]} */ (Object.keys(KINDS))
			.map((kind) => {
				const of = $jobs.filter((job) => job.kind === kind);
				if (of.length < 2) return null;
				const common = of[0].targets.filter((target) =>
					of.every((job) => job.targets.some((other) => other.id === target.id))
				);
				return { kind, count: of.length, targets: common };
			})
			.filter(Boolean)
	);

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

	/** The targets of a file, by their group, for the menu */
	function grouped(targets) {
		const out = new Map();
		for (const target of targets) {
			if (!out.has(target.group)) out.set(target.group, []);
			out.get(target.group).push(target);
		}
		return [...out];
	}

	function add(files) {
		const count = addFiles(files);
		if (count)
			showToast(`${count} file${count === 1 ? '' : 's'} added`, 'icon-[mingcute--file-new-line]');
	}

	function drop(event) {
		event.preventDefault();
		dragging = 0;
		if (event.dataTransfer?.files?.length) add(event.dataTransfer.files);
	}

	async function reveal(path) {
		try {
			await revealItemInDir(path ?? (await outputFolder()));
		} catch (error) {
			console.error('Could not show the folder:', error);
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	let zipping = $state(false);
	async function zipAll() {
		zipping = true;
		try {
			const path = await saveAllAsZip();
			showToast('Saved everything as one ZIP', 'icon-[mingcute--file-zip-line]');
			reveal(path);
		} catch (error) {
			console.error('Could not make the ZIP:', error);
			showToast("Couldn't make the ZIP", 'icon-[mingcute--warning-line]');
		} finally {
			zipping = false;
		}
	}

	const allowDrop = (event) => {
		if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
	};

	onDestroy(() => (dragging = 0));
</script>

<div
	class="relative min-h-full pb-12"
	role="region"
	aria-label="File converter"
	ondragenter={(event) => {
		if (event.dataTransfer?.types?.includes('Files')) dragging++;
	}}
	ondragleave={() => (dragging = Math.max(0, dragging - 1))}
	ondragover={allowDrop}
	ondrop={drop}
>
	<!-- Header -->
	<div class="relative overflow-hidden">
		<div
			class="absolute inset-0 opacity-70"
			style="background: linear-gradient(135deg, #f59e0b, #ef4444 60%, transparent)"
		></div>
		<span
			class="icon-[mingcute--transfer-line] absolute -right-10 -top-10 size-72 text-white/10 rotate-12"
		></span>
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent"></div>
		<div class="relative px-8 pt-10 pb-6">
			<p class="text-sm font-bold uppercase tracking-wide text-white/70">Stosufy</p>
			<h1 class="flex items-center gap-3 text-5xl font-extrabold tracking-tight">
				<span class="icon-[mingcute--transfer-line] size-11"></span>File converter
			</h1>
			<p class="mt-2 max-w-2xl text-white/80">
				Pictures, sound, video, data and text into other formats. Everything happens on your
				computer, nothing is uploaded; the results are saved in
				<button
					class="font-semibold underline decoration-white/30 underline-offset-2 hover:decoration-white cursor-pointer"
					onclick={() => reveal()}>Stosufy/Converted</button
				>.
			</p>
		</div>
	</div>

	<div class="px-8 flex flex-col gap-5">
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

		<!-- Where files go in -->
		<button
			class="group flex items-center justify-center gap-4 rounded-2xl border-2 border-dashed cursor-pointer transition {dragging
				? 'border-amber-300 bg-amber-300/10'
				: 'border-white/15 hover:border-white/30 hover:bg-white/[0.03]'} {$jobs.length
				? 'h-20'
				: 'h-56 flex-col'}"
			onclick={() => input.click()}
		>
			<span
				class="icon-[mingcute--upload-2-line] {$jobs.length
					? 'size-7'
					: 'size-12'} text-white/60 group-hover:text-white transition"
			></span>
			<span class="text-center">
				<span class="block font-semibold {$jobs.length ? '' : 'text-lg'}">
					{dragging ? 'Let go to add them' : $jobs.length ? 'Add more files' : 'Drop files here'}
				</span>
				{#if !$jobs.length}
					<span class="block mt-1 text-sm text-secondary-600">
						or click to choose them: pictures, sound, videos, JSON, CSV, Markdown, ZIPs, anything
					</span>
				{/if}
			</span>
		</button>

		{#if $jobs.length}
			<!-- How -->
			<div class="flex flex-wrap items-center gap-3 text-sm">
				<div
					class="inline-flex gap-1 p-1 rounded-full bg-white/[0.06]"
					role="radiogroup"
					aria-label="Quality"
					title="Smaller files or better quality (sound, video, JPG and WebP)"
				>
					{#each QUALITIES as [id, label] (id)}
						<button
							role="radio"
							aria-checked={$options.quality === id}
							class="h-7 px-3 rounded-full font-semibold cursor-pointer transition {$options.quality ===
							id
								? 'bg-white text-black'
								: 'text-white/70 hover:text-white'}"
							onclick={() => ($options.quality = id)}
						>
							{label}
						</button>
					{/each}
				</div>
				{#if hasKind.has('image')}
					<label class="flex items-center gap-2 h-9 pl-3 pr-1 rounded-full bg-white/[0.06]">
						<span class="icon-[mingcute--pic-line] size-4 text-white/60"></span>
						<span class="sr-only">Picture size</span>
						<select
							class="h-7 pr-2 bg-transparent font-semibold cursor-pointer outline-none"
							bind:value={$options.imageSize}
						>
							{#each IMAGE_SIZES as [value, label] (value)}
								<option {value} class="bg-panel">{label}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if hasKind.has('video')}
					<label class="flex items-center gap-2 h-9 pl-3 pr-1 rounded-full bg-white/[0.06]">
						<span class="icon-[mingcute--video-line] size-4 text-white/60"></span>
						<span class="sr-only">Video size</span>
						<select
							class="h-7 pr-2 bg-transparent font-semibold cursor-pointer outline-none"
							bind:value={$options.videoHeight}
						>
							{#each VIDEO_HEIGHTS as [value, label] (value)}
								<option {value} class="bg-panel">{label}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#each groups as group (group.kind)}
					<label class="flex items-center gap-2 h-9 pl-3 pr-1 rounded-full bg-white/[0.06]">
						<span class="{KINDS[group.kind].icon} size-4 {KINDS[group.kind].tint}"></span>
						<span class="text-white/70">All {group.count} {KINDS[group.kind].label} to</span>
						<select
							class="h-7 pr-2 bg-transparent font-semibold cursor-pointer outline-none"
							aria-label="All {KINDS[group.kind].label} to"
							value=""
							onchange={(event) => {
								if (event.currentTarget.value)
									setTargetForAll(event.currentTarget.value, group.kind);
								event.currentTarget.value = '';
							}}
						>
							<option value="" class="bg-panel">…</option>
							{#each grouped(group.targets) as [name, targets] (name)}
								<optgroup label={name} class="bg-panel">
									{#each targets as target (target.id + name)}
										<option value={target.id} class="bg-panel">{target.label}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
					</label>
				{/each}
			</div>

			<!-- The files -->
			<ul class="flex flex-col gap-2" aria-label="Files">
				{#each $jobs as job (job.id)}
					{@const kind = KINDS[job.kind]}
					{@const busy = job.status === 'working' || job.status === 'waiting'}
					<li
						in:fly={{ y: 8, duration: 180 }}
						class="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 rounded-xl bg-white/[0.04] ring-1 ring-white/5"
						aria-label={job.file.name}
						data-status={job.status}
					>
						<div
							class="size-12 shrink-0 grid place-items-center rounded-lg bg-black/30 overflow-hidden"
						>
							{#if job.preview}
								<img src={job.preview} alt="" class="size-full object-cover" />
							{:else}
								<span class="{kind.icon} size-6 {kind.tint}"></span>
							{/if}
						</div>
						<div class="min-w-0 flex-1 basis-48">
							<p class="truncate font-semibold" title={job.file.name}>{job.file.name}</p>
							<p class="text-xs text-secondary-600">
								{job.format?.label ?? 'File'} · {size(job.file.size)}
							</p>
						</div>

						<span class="icon-[mingcute--arrow-right-line] size-5 text-white/40"></span>
						<select
							class="h-9 px-3 rounded-full bg-white/[0.08] font-semibold text-sm cursor-pointer outline-none disabled:opacity-60 disabled:cursor-default"
							aria-label="Convert {job.file.name} to"
							value={job.target}
							disabled={busy}
							onchange={(event) => setTarget(job.id, event.currentTarget.value)}
						>
							{#each grouped(job.targets) as [name, targets] (name)}
								<optgroup label={name} class="bg-panel">
									{#each targets as target (target.id + name)}
										<option value={target.id} class="bg-panel">{target.label}</option>
									{/each}
								</optgroup>
							{/each}
						</select>

						<div class="w-56 shrink-0 flex items-center justify-end gap-2 text-sm">
							{#if job.status === 'ready'}
								<button
									class="h-9 px-4 rounded-full font-semibold bg-white text-black hover:bg-white/90 cursor-pointer transition"
									onclick={() => convert([job.id])}
								>
									Convert
								</button>
							{:else if job.status === 'waiting'}
								<span class="text-secondary-600">Waiting…</span>
							{:else if job.status === 'working'}
								<div
									class="flex-1 flex items-center gap-2"
									role="progressbar"
									aria-valuenow={Math.round(job.progress * 100)}
								>
									<div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
										{#if job.progress > 0}
											<div
												class="h-full rounded-full bg-amber-300 transition-[width]"
												style="width: {job.progress * 100}%"
											></div>
										{:else}
											<div class="h-full w-1/3 rounded-full bg-amber-300/70 animate-pulse"></div>
										{/if}
									</div>
									<span class="w-9 text-right tabular-nums text-white/70">
										{job.progress > 0 ? `${Math.round(job.progress * 100)}%` : ''}
									</span>
								</div>
							{:else if job.status === 'done'}
								<span class="flex items-center gap-1 text-emerald-300 font-semibold">
									<span class="icon-[mingcute--check-circle-line] size-4"></span>
									{job.saved.length === 1 ? size(job.saved[0].size) : `${job.saved.length} files`}
								</span>
								<button
									class="h-9 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
									title={job.saved.map((file) => file.name).join('\n')}
									onclick={() => reveal(job.saved[0]?.path)}
								>
									<span class="icon-[mingcute--folder-open-line] size-4"></span>
									Show
								</button>
							{:else if job.status === 'failed'}
								<button
									class="h-9 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
									onclick={() => convert([job.id])}
								>
									<span class="icon-[mingcute--refresh-2-line] size-4"></span>
									Try again
								</button>
							{/if}
						</div>
						<button
							class="size-8 grid place-items-center rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition disabled:opacity-30 disabled:cursor-default"
							aria-label="Remove {job.file.name}"
							disabled={job.status === 'working'}
							onclick={() => removeJob(job.id)}
						>
							<span class="icon-[mingcute--close-line] size-4"></span>
						</button>
						{#if job.status === 'failed'}
							<p class="basis-full pl-16 text-sm text-red-300 flex items-center gap-1.5">
								<span class="icon-[mingcute--warning-line] size-4 shrink-0"></span>
								{job.error}
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			<!-- Everything at once -->
			<div class="flex flex-wrap items-center gap-2">
				<button
					class="h-10 px-5 flex items-center gap-2 rounded-full font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition disabled:opacity-50 disabled:cursor-default"
					disabled={!ready.length}
					onclick={() => convert()}
				>
					{#if working}
						<span class="icon-[mingcute--loading-line] size-4 animate-spin"></span>
					{:else}
						<span class="icon-[mingcute--transfer-line] size-4"></span>
					{/if}
					Convert {ready.length > 1 ? `all ${ready.length}` : ready.length ? '' : 'all'}
				</button>
				{#if savedCount > 1}
					<button
						class="h-10 px-4 flex items-center gap-2 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition disabled:opacity-50"
						disabled={zipping || working}
						onclick={zipAll}
					>
						<span class="icon-[mingcute--file-zip-line] size-4"></span>
						Save all as one ZIP
					</button>
				{/if}
				{#if finished.length}
					<button
						class="h-10 px-4 flex items-center gap-2 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
						onclick={() => reveal()}
					>
						<span class="icon-[mingcute--folder-open-line] size-4"></span>
						Open the folder
					</button>
				{/if}
				<button
					class="ml-auto h-10 px-4 rounded-full text-sm font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition disabled:opacity-40 disabled:cursor-default"
					disabled={working && !finished.length}
					onclick={() => clearJobs(!working)}
				>
					{working ? 'Clear finished' : 'Clear the list'}
				</button>
			</div>
		{/if}
	</div>

	{#if dragging}
		<div
			class="pointer-events-none fixed inset-0 z-30 grid place-items-center bg-black/40 backdrop-blur-[2px]"
			transition:fly={{ y: 0, duration: 120 }}
		>
			<div
				class="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl bg-panel/90 ring-2 ring-amber-300/60"
			>
				<span class="icon-[mingcute--upload-2-line] size-12 text-amber-300"></span>
				<p class="text-lg font-bold">Drop to add the files</p>
			</div>
		</div>
	{/if}
</div>
