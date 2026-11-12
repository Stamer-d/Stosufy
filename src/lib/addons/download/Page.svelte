<script>
	// The downloader: a link pasted, what it is shown, then what's wanted of it (the video or
	// its sound, how good, maybe only a part), and it's downloaded to ~/Stosufy/Downloads, to
	// be copied, dragged out, edited or converted from there.
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { showToast } from '#lib/stores/toast.ts';
	import { installedAddons } from '#lib/addons/store.ts';
	import { outputFolder, reveal } from '../files/save.ts';
	import { handOver } from '../files/handoff.ts';
	import { PickedFile } from '../files/picked.ts';
	import { dragOut } from '../files/dragout.ts';
	import { clock } from '../files/time.ts';
	import CopyButton from '../files/CopyButton.svelte';
	import PartPicker from './PartPicker.svelte';
	import { ensureTools, isYouTube, lookUp, tools } from './ytdlp.ts';
	import {
		FOLDER,
		addDownload,
		clearFinished,
		downloads,
		removeDownload,
		retry,
		stop
	} from './jobs.ts';

	const OPTIONS_KEY = 'stosufy-download-options';
	const VIDEO_FORMATS = [
		['mp4', 'MP4', 'Plays everywhere (also in Premiere, on phones)'],
		['mkv', 'Best quality', 'The best there is, up to 4K/8K (as MKV)']
	];
	const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav'];
	const BROWSERS = [
		[null, 'Nobody'],
		['chrome', 'Chrome'],
		['firefox', 'Firefox'],
		['edge', 'Edge'],
		['brave', 'Brave'],
		['opera', 'Opera'],
		['vivaldi', 'Vivaldi'],
		['safari', 'Safari'],
		['chromium', 'Chromium']
	];
	const PHASES = {
		download: 'Downloading',
		Merger: 'Putting video and sound together',
		ExtractAudio: 'Making the sound file',
		FFmpegVideoRemuxer: 'Making it the format chosen',
		FFmpegVideoConvertor: 'Making it the format chosen',
		EmbedThumbnail: 'Adding its picture',
		Metadata: 'Adding its title',
		ModifyChapters: 'Taking out the sponsors',
		SponsorBlock: 'Finding the sponsors',
		FixupM3u8: 'Tidying it up',
		MoveFiles: 'Almost done'
	};

	function load() {
		const fallback = {
			kind: 'video',
			videoFormat: 'mp4',
			audioFormat: 'mp3',
			height: null,
			sponsorblock: true,
			cookies: null
		};
		try {
			return { ...fallback, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') };
		} catch {
			return fallback;
		}
	}
	let options = $state(load());
	$effect(() => {
		const value = JSON.stringify(options);
		try {
			localStorage.setItem(OPTIONS_KEY, value);
		} catch {
			// (only a convenience)
		}
	});

	let link = $state('');
	/** @type {{ state: 'idle' | 'loading' | 'ready' | 'failed', info?: import('./ytdlp.ts').LinkInfo, error?: string }} */
	let found = $state({ state: 'idle' });
	let part = $state({ on: false, start: 0, end: 0, exact: true });
	let wholePlaylist = $state(true);
	let looked = '';

	let canEdit = $derived($installedAddons.some((addon) => addon.id === 'edit'));
	let canConvert = $derived($installedAddons.some((addon) => addon.id === 'convert'));
	let info = $derived(found.info);
	let youtube = $derived(info ? isYouTube(info.url) : false);
	/** The heights to choose from: what it has, the usual ones */
	let heights = $derived(
		(info?.heights ?? []).filter((h) => [4320, 2160, 1440, 1080, 720, 480, 360].includes(h))
	);

	const heightLabel = (h) => (h === 4320 ? '8K' : h === 2160 ? '4K' : `${h}p`);
	const isLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

	async function look(text = link) {
		const url = text.trim();
		if (!isLink(url) || url === looked) return;
		looked = url;
		found = { state: 'loading' };
		try {
			const result = await lookUp(url, options.cookies);
			if (looked !== url) return;
			found = { state: 'ready', info: result };
			part = { on: false, start: 0, end: result.duration, exact: true };
			wholePlaylist = true;
			if (!result.video) options.kind = 'audio';
		} catch (error) {
			if (looked !== url) return;
			const message = String(error?.message ?? error);
			if (message === 'Stopped') return;
			found = { state: 'failed', error: message };
			looked = '';
		}
	}

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let typing;
	function typed() {
		clearTimeout(typing);
		if (!link.trim()) {
			found = { state: 'idle' };
			looked = '';
			return;
		}
		typing = setTimeout(() => look(), 450);
	}

	async function pasteLink() {
		try {
			const text = (await navigator.clipboard.readText()).trim();
			if (!isLink(text)) {
				showToast('No link on the clipboard', 'icon-[mingcute--warning-line]');
				return;
			}
			link = text;
			void look(text);
		} catch {
			showToast('Paste the link into the field (Ctrl+V)', 'icon-[mingcute--information-line]');
		}
	}

	function start() {
		if (!info) return;
		const audio = options.kind === 'audio' || !info.video;
		const playlist = info.kind === 'playlist';
		/** @type {[number, number][]} */
		const sections =
			part.on && !playlist && info.duration && (part.start > 0 || part.end < info.duration)
				? [[part.start, part.end]]
				: [];
		addDownload($state.snapshot(info), {
			url: info.url,
			kind: audio ? 'audio' : 'video',
			format: audio ? options.audioFormat : options.videoFormat,
			height: audio ? null : options.height,
			sections,
			exactCuts: part.exact,
			sponsorblock: youtube && options.sponsorblock && !sections.length,
			playlist: playlist && wholePlaylist,
			cookies: options.cookies
		});
		// (ready for the next link)
		link = '';
		looked = '';
		found = { state: 'idle' };
	}

	async function show(path) {
		try {
			await reveal(path ?? (await outputFolder(FOLDER)));
		} catch {
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	/** What was downloaded, for the editor or the converter (read where it is) */
	const asFiles = (job) =>
		job.saved.map((file) => new PickedFile(file.path, file.name.split('/').pop(), file.size));

	function summary(job) {
		const r = job.request;
		const what =
			r.kind === 'audio'
				? r.format.toUpperCase()
				: `${r.format === 'mkv' ? 'Best quality' : 'MP4'}${r.height ? ` · ${r.height}p` : ''}`;
		const cut = r.sections.length
			? ` · ${clock(r.sections[0][0]).replace(/\.\d$/, '')}–${clock(r.sections[0][1]).replace(/\.\d$/, '')}`
			: '';
		return `${what}${cut}${r.playlist ? ` · ${job.info.count} videos` : ''}`;
	}

	onMount(() => {
		void ensureTools();
	});
</script>

{#snippet chips(label, items, value, onpick)}
	<div class="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label}>
		{#each items as [id, text, title] (id ?? 'none')}
			<button
				role="radio"
				aria-checked={value === id}
				{title}
				class="h-8 px-3 rounded-full text-sm font-bold cursor-pointer transition {value === id
					? 'bg-white text-black'
					: 'bg-white/[0.08] hover:bg-white/15'}"
				onclick={() => onpick(id)}
			>
				{text}
			</button>
		{/each}
	</div>
{/snippet}

<div class="relative min-h-full pb-12">
	<!-- Header -->
	<div class="relative overflow-hidden">
		<div
			class="absolute inset-0 opacity-60"
			style="background: linear-gradient(120deg, #e11d48, #7c3aed 55%, transparent)"
		></div>
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent"></div>
		<div class="relative px-8 pt-9 pb-5 flex flex-wrap items-end justify-between gap-4">
			<div class="min-w-0">
				<h1 class="flex items-center gap-3 text-4xl font-extrabold tracking-tight">
					<span class="icon-[mingcute--download-3-line] size-9"></span>Downloader
				</h1>
				<p class="mt-1.5 text-white/75">
					Videos and their sound from YouTube, Twitch and many more, whole or just a part.
				</p>
				{#if $tools.status === 'downloading'}
					<p class="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-200/90">
						<span class="icon-[mingcute--loading-line] size-3.5 animate-spin"></span>
						{$tools.what === 'deno'
							? 'Getting YouTube support ready'
							: $tools.what === 'ffmpeg'
								? 'Getting FFmpeg ready'
								: 'Getting the downloader ready'}… {Math.round($tools.progress * 100)}%
					</p>
				{:else if $tools.status === 'failed' || $tools.status === 'unavailable'}
					<p class="mt-2 flex items-center gap-1.5 text-xs text-red-200">
						<span class="icon-[mingcute--warning-line] size-3.5"></span>
						{$tools.status === 'unavailable'
							? "There's no downloader for this computer"
							: `The downloader couldn't be set up: ${$tools.error}`}
						{#if $tools.status === 'failed'}
							<button class="font-semibold underline cursor-pointer" onclick={() => ensureTools()}>
								Try again
							</button>
						{/if}
					</p>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<label
					class="relative h-9 pl-3 pr-2 flex items-center gap-1.5 rounded-full text-sm cursor-pointer transition {options.cookies
						? 'bg-white text-black'
						: 'bg-black/25 hover:bg-black/40'}"
					title="For what needs an account (age-restricted, members only): signed in as in this browser"
				>
					<span class="icon-[mingcute--user-3-line] size-4 opacity-70"></span>
					<span class="font-semibold">
						Signed in: {BROWSERS.find(([id]) => id === options.cookies)?.[1]}
					</span>
					<span class="icon-[mingcute--down-line] size-3.5 opacity-60"></span>
					<select
						class="absolute inset-0 opacity-0 cursor-pointer"
						aria-label="Signed in as"
						bind:value={options.cookies}
					>
						{#each BROWSERS as [id, label] (id ?? 'none')}
							<option value={id} class="bg-panel text-white">{label}</option>
						{/each}
					</select>
				</label>
				<button
					class="h-9 px-3 flex items-center gap-1.5 rounded-full bg-black/25 hover:bg-black/40 text-sm font-semibold cursor-pointer transition"
					title="Where the downloads are: Stosufy/Downloads"
					onclick={() => show()}
				>
					<span class="icon-[mingcute--folder-open-line] size-4 text-white/70"></span>
					Open folder
				</button>
			</div>
		</div>
	</div>

	<div class="px-8 flex flex-col gap-4">
		<!-- The link -->
		<div
			class="flex items-center gap-2 p-2 pl-4 rounded-2xl bg-white/[0.05] ring-1 ring-white/10 focus-within:ring-rose-300/60 transition"
		>
			<span class="icon-[mingcute--link-line] size-5 text-white/50 shrink-0"></span>
			<input
				class="flex-1 min-w-0 h-10 bg-transparent text-base outline-none placeholder:text-white/35"
				placeholder="Paste a link from YouTube, Twitch, TikTok, SoundCloud, X, …"
				aria-label="Link"
				bind:value={link}
				oninput={typed}
				onkeydown={(event) => event.key === 'Enter' && look()}
				onpaste={(event) => {
					const text = event.clipboardData?.getData('text') ?? '';
					if (isLink(text)) setTimeout(() => look(text));
				}}
			/>
			{#if found.state === 'loading'}
				<span class="icon-[mingcute--loading-line] size-5 text-white/60 animate-spin shrink-0"
				></span>
			{/if}
			<button
				class="h-10 px-4 flex items-center gap-1.5 rounded-xl text-sm font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition shrink-0"
				onclick={pasteLink}
			>
				<span class="icon-[mingcute--clipboard-line] size-4"></span>
				Paste
			</button>
		</div>

		{#if found.state === 'failed'}
			<p class="flex items-center gap-1.5 text-sm text-red-300" transition:fade={{ duration: 120 }}>
				<span class="icon-[mingcute--warning-line] size-4 shrink-0"></span>
				{found.error}
			</p>
		{:else if found.state === 'loading'}
			<p class="text-sm text-white/50">Looking at the link…</p>
		{:else if found.state === 'ready' && info}
			<!-- What it is, and what's wanted of it -->
			<section
				class="flex flex-col gap-4 p-4 rounded-2xl bg-white/[0.04] ring-1 ring-white/5"
				aria-label="What it is"
				transition:fade={{ duration: 120 }}
			>
				<div class="flex gap-4 min-w-0">
					<div
						class="w-40 aspect-video shrink-0 rounded-lg bg-black/40 overflow-hidden grid place-items-center"
					>
						{#if info.thumbnail}
							<img
								src={info.thumbnail}
								alt=""
								class="size-full object-cover"
								referrerpolicy="no-referrer"
							/>
						{:else}
							<span class="icon-[mingcute--video-line] size-8 text-white/30"></span>
						{/if}
					</div>
					<div class="min-w-0">
						<p class="text-xs font-bold uppercase tracking-wide text-rose-200/80">
							{info.site}{info.kind === 'playlist' ? ' · Playlist' : ''}{info.live ? ' · Live' : ''}
						</p>
						<h2 class="text-lg font-bold leading-snug line-clamp-2" title={info.title}>
							{info.title}
						</h2>
						<p class="mt-0.5 text-sm text-white/60">
							{[
								info.uploader,
								info.kind === 'playlist'
									? `${info.count} videos`
									: info.duration
										? clock(info.duration).replace(/\.\d$/, '')
										: null
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
					</div>
				</div>

				{#if info.live}
					<p class="flex items-center gap-1.5 text-sm text-amber-200">
						<span class="icon-[mingcute--information-line] size-4"></span>
						It's live right now: it can be downloaded once the stream has ended.
					</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#if info.video}
							{@render chips(
								'What',
								[
									['video', 'Video'],
									['audio', 'Only the sound']
								],
								options.kind,
								(id) => (options.kind = id)
							)}
						{/if}
						{#if options.kind === 'video' && info.video}
							<div class="flex flex-wrap items-center gap-3">
								{@render chips(
									'Video format',
									VIDEO_FORMATS,
									options.videoFormat,
									(id) => (options.videoFormat = id)
								)}
								<span class="w-px h-6 bg-white/10"></span>
								{@render chips(
									'Quality',
									[[null, 'Best'], ...heights.map((h) => [h, heightLabel(h)])],
									heights.includes(options.height) || options.height === null
										? options.height
										: null,
									(id) => (options.height = id)
								)}
							</div>
						{:else}
							{@render chips(
								'Sound format',
								AUDIO_FORMATS.map((id) => [id, id.toUpperCase()]),
								options.audioFormat,
								(id) => (options.audioFormat = id)
							)}
						{/if}

						{#if info.kind === 'playlist'}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="accent-rose-400 size-4"
									bind:checked={wholePlaylist}
								/>
								All {info.count} videos of the playlist
							</label>
						{:else if info.duration}
							<div class="flex flex-col gap-2">
								<label class="flex items-center gap-2 text-sm">
									<input type="checkbox" class="accent-rose-400 size-4" bind:checked={part.on} />
									Only a part of it
									<span class="text-white/45"
										>(a clip of a long stream: only that part is downloaded)</span
									>
								</label>
								{#if part.on}
									<PartPicker
										duration={info.duration}
										bind:start={part.start}
										bind:end={part.end}
									/>
									<label class="flex items-center gap-2 text-sm text-white/70">
										<input
											type="checkbox"
											class="accent-rose-400 size-4"
											bind:checked={part.exact}
										/>
										Cut exactly (slower; else at the nearest keyframe)
									</label>
								{/if}
							</div>
						{/if}

						{#if youtube && !part.on}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="accent-rose-400 size-4"
									bind:checked={options.sponsorblock}
								/>
								Take out sponsors and the like (SponsorBlock)
							</label>
						{/if}
					</div>

					<div>
						<button
							class="h-11 px-6 flex items-center gap-2 rounded-full text-base font-bold bg-rose-500 hover:bg-rose-400 text-white cursor-pointer transition"
							onclick={start}
						>
							<span class="icon-[mingcute--download-3-line] size-5"></span>
							Download
						</button>
					</div>
				{/if}
			</section>
		{:else if !$downloads.length}
			<div class="flex flex-col items-center gap-2 py-12 text-center text-white/50">
				<span class="icon-[mingcute--download-3-line] size-10"></span>
				<p class="text-lg font-semibold text-white/80">Paste a link to start</p>
				<p class="text-sm">
					A whole video, only its sound, or just the part of a long stream you want.
				</p>
			</div>
		{/if}

		<!-- The downloads -->
		{#if $downloads.length}
			<div class="flex items-center justify-between mt-2">
				<h2 class="text-sm font-bold uppercase tracking-wide text-white/50">Downloads</h2>
				{#if $downloads.some((job) => job.status === 'done' || job.status === 'failed')}
					<button
						class="h-8 px-3 rounded-full text-sm font-semibold text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition"
						onclick={clearFinished}
					>
						Clear finished
					</button>
				{/if}
			</div>
			<ul class="flex flex-col gap-2" aria-label="Downloads">
				{#each $downloads as job (job.id)}
					<li
						class="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 rounded-xl bg-white/[0.04] ring-1 ring-white/5"
						aria-label={job.info.title}
						data-status={job.status}
					>
						<div class="min-w-0 flex-1 basis-64 flex items-center gap-3">
							<div
								class="w-20 aspect-video shrink-0 rounded-md bg-black/40 overflow-hidden grid place-items-center"
							>
								{#if job.info.thumbnail}
									<img
										src={job.info.thumbnail}
										alt=""
										class="size-full object-cover"
										referrerpolicy="no-referrer"
									/>
								{:else}
									<span class="icon-[mingcute--video-line] size-5 text-white/30"></span>
								{/if}
							</div>
							<div class="min-w-0">
								<p class="truncate font-semibold" title={job.info.title}>{job.info.title}</p>
								<p class="text-xs text-secondary-600">{job.info.site} · {summary(job)}</p>
							</div>
						</div>

						<div class="flex flex-wrap items-center justify-end gap-2 text-sm">
							{#if job.status === 'waiting'}
								<span class="text-white/50">Waiting…</span>
							{:else if job.status === 'working'}
								<div class="w-64 flex flex-col gap-1">
									<div
										class="h-1.5 rounded-full bg-white/10 overflow-hidden"
										role="progressbar"
										aria-valuenow={Math.round(job.percent ?? 0)}
									>
										{#if job.phase === 'download' && job.percent !== null}
											<div
												class="h-full rounded-full bg-rose-400 transition-[width]"
												style="width: {job.percent}%"
											></div>
										{:else}
											<div class="h-full w-full rounded-full bg-rose-400/50 animate-pulse"></div>
										{/if}
									</div>
									<p class="text-xs text-white/60 tabular-nums truncate">
										{PHASES[job.phase] ?? 'Finishing'}{job.phase === 'download' && job.stream > 1
											? ' the sound'
											: ''}{job.phase === 'download' && job.percent !== null
											? ` · ${Math.round(job.percent)}%`
											: '…'}{job.phase === 'download' && job.speed
											? ` · ${job.speed}`
											: ''}{job.phase === 'download' && job.eta ? ` · ${job.eta} left` : ''}
									</p>
								</div>
							{:else if job.status === 'done'}
								<button
									class="h-8 pl-2.5 pr-3 flex items-center gap-1.5 rounded-full font-semibold text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 cursor-pointer transition"
									title="Drag it out into a chat or a folder, or click to show it in its folder"
									use:dragOut={job.saved.map((file) => file.path)}
									onclick={() => show(job.saved[0]?.path)}
								>
									<span class="icon-[mingcute--check-circle-fill] size-4"></span>
									<span class="max-w-56 truncate">
										{job.saved.length === 1 ? job.saved[0].name : `${job.saved.length} files`}
									</span>
								</button>
								<CopyButton files={job.saved} />
								{#if canEdit && job.saved.length === 1}
									<button
										class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
										title="Open it in the file editor: cut, fade, turn, …"
										onclick={() => handOver('edit', asFiles(job))}
									>
										<span class="icon-[mingcute--scissors-line] size-4"></span>
										Edit
									</button>
								{/if}
								{#if canConvert}
									<button
										class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
										title="Make it into another format in the file converter"
										onclick={() => handOver('convert', asFiles(job))}
									>
										<span class="icon-[mingcute--transfer-line] size-4"></span>
										Convert
									</button>
								{/if}
							{:else if job.status === 'failed'}
								<span class="max-w-96 flex items-center gap-1.5 text-red-300" title={job.error}>
									<span class="icon-[mingcute--warning-line] size-4 shrink-0"></span>
									<span class="line-clamp-2">{job.error}</span>
								</span>
								<button
									class="h-8 px-3 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
									onclick={() => retry(job.id)}
								>
									Try again
								</button>
							{/if}
							{#if job.status === 'working' || job.status === 'waiting'}
								<button
									class="size-8 grid place-items-center rounded-full text-white/40 hover:text-white hover:bg-white/10 cursor-pointer transition"
									aria-label="Stop {job.info.title}"
									title="Stop"
									onclick={() => stop(job.id)}
								>
									<span class="icon-[mingcute--stop-circle-line] size-4"></span>
								</button>
							{:else}
								<button
									class="size-8 grid place-items-center rounded-full text-white/40 hover:text-white hover:bg-white/10 cursor-pointer transition"
									aria-label="Remove {job.info.title}"
									title="Take it off the list (the file stays)"
									onclick={() => removeDownload(job.id)}
								>
									<span class="icon-[mingcute--close-line] size-4"></span>
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
