<script module>
	/** The links offered or used already (not offered again, also after leaving the page) */
	const used = new Set();
</script>

<script>
	// The downloader: a link pasted, what it is shown, then what's wanted of it (the video or
	// its sound, its format and quality, maybe only a part), and it's downloaded to
	// ~/Stosufy/Downloads, to be copied, dragged out, edited or converted from there. What was
	// chosen last is chosen again (where a link has it), else the best there is.
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { fade } from 'svelte/transition';
	import { showToast } from '#lib/stores/toast.ts';
	import { installedAddons } from '#lib/addons/store.ts';
	import { outputFolder, reveal } from '../files/save.ts';
	import { handOver } from '../files/handoff.ts';
	import { PickedFile } from '../files/picked.ts';
	import { dragOut } from '../files/dragout.ts';
	import { clock } from '../files/time.ts';
	import { sizeText } from '../files/size.ts';
	import CopyButton from '../files/CopyButton.svelte';
	import Dropdown from '../files/Dropdown.svelte';
	import PartPicker from './PartPicker.svelte';
	import { ensureTools, isYouTube, lookUp, tools } from './ytdlp.ts';
	import {
		FOLDER,
		addDownload,
		checkFiles,
		clearFinished,
		downloads,
		removeDownload,
		retry,
		stop
	} from './jobs.ts';

	const OPTIONS_KEY = 'stosufy-download-options';
	const AUDIO_FORMATS = [
		{ value: 'mp3', label: 'MP3', hint: 'plays everywhere' },
		{ value: 'm4a', label: 'M4A · AAC', hint: 'small, good quality, Apple devices' },
		{ value: 'opus', label: 'Opus', hint: 'the best quality for its size' },
		{ value: 'flac', label: 'FLAC', hint: 'lossless, big' },
		{ value: 'wav', label: 'WAV', hint: 'lossless, uncompressed, biggest' },
		{ value: 'original', label: 'Original', hint: 'as it is there, not converted: fastest' }
	];
	/** The bitrates to choose from (where there are: not for lossless, nor as it is) */
	const KBPS = { mp3: [320, 256, 192, 128], m4a: [320, 256, 192, 128], opus: [192, 160, 128, 96] };
	/** A playlist's (its videos' qualities aren't known): at most that high */
	const HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
	const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
	const BROWSERS = [
		{ value: null, label: 'Not signed in', hint: 'enough for almost everything' },
		...[
			'Chrome',
			'Firefox',
			'Edge',
			'Brave',
			'Opera',
			'Vivaldi',
			'Chromium',
			...(MAC ? ['Safari'] : [])
		].map((name) => ({
			value: name.toLowerCase(),
			label: `As in ${name}`,
			hint: 'for age-restricted or members-only videos'
		}))
	];
	const PHASES = {
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
			tab: 'video',
			codec: 'h264',
			height: null,
			audioFormat: 'mp3',
			audioKbps: null,
			sponsorblock: true,
			cookies: null
		};
		try {
			const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
			// (as it was kept before: "kind", and MP4 or "Best quality")
			if (stored.kind && !stored.tab) stored.tab = stored.kind;
			if (stored.videoFormat && !stored.codec)
				stored.codec = stored.videoFormat === 'mkv' ? 'any' : 'h264';
			const { tab, codec, height, audioFormat, audioKbps, sponsorblock, cookies } = {
				...fallback,
				...stored
			};
			return { tab, codec, height, audioFormat, audioKbps, sponsorblock, cookies };
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
	/** Which of a playlist's videos (null: all) */
	let items = $state(null);
	let looked = '';

	let canEdit = $derived($installedAddons.some((addon) => addon.id === 'edit'));
	let canConvert = $derived($installedAddons.some((addon) => addon.id === 'convert'));
	let info = $derived(found.info);
	let youtube = $derived(info ? isYouTube(info.url) : false);
	let playlist = $derived(info?.kind === 'playlist');

	// --- What's chosen: the last choice where this link has it, else the best -----------------

	/** Video or sound (a link with only sound: sound, without that being kept) */
	let tab = $derived(info?.video ? options.tab : 'audio');
	let choice = $derived(
		info?.videos.find((video) => video.id === options.codec) ?? info?.videos[0] ?? null
	);
	/** The heights it comes in, in that codec (a playlist's: the usual ones, not known) */
	let qualities = $derived(
		choice?.qualities.length
			? choice.qualities
			: HEIGHTS.map((height) => ({ height, fps: 0, bytes: null }))
	);
	/** The height chosen last; else the highest under it; else the best (null) */
	let height = $derived.by(() => {
		const wanted = options.height;
		if (!wanted) return null;
		return (qualities.find((quality) => quality.height <= wanted) ?? null)?.height ?? null;
	});
	let kbpsChoices = $derived(KBPS[options.audioFormat] ?? []);
	let kbps = $derived(kbpsChoices.includes(options.audioKbps) ? options.audioKbps : null);

	/** The share of it that's downloaded (a part of it, or all) */
	let share = $derived(
		part.on && info?.duration ? Math.max(0, part.end - part.start) / info.duration : 1
	);
	const about = (bytes) => (bytes ? `≈ ${sizeText(Math.round(bytes * share))}` : '');
	const heightLabel = (h) => (h === 4320 ? '8K' : h === 2160 ? '4K' : `${h}p`);
	/** How big a video'd be, in a quality (its picture and its sound) */
	const videoBytes = (quality) => (quality?.bytes ? quality.bytes + (info?.audioBytes ?? 0) : null);
	/** How big the sound'd be, in a format at a bitrate (null: the best) */
	function audioBytes(format, rate) {
		const seconds = info?.duration ?? 0;
		if (format === 'original' || (!rate && (format === 'opus' || format === 'm4a')))
			return info?.audioBytes ?? null;
		if (!seconds) return null;
		if (rate) return (rate * 1000 * seconds) / 8;
		// (MP3 at its best, VBR V0: about 245 kbps)
		return format === 'mp3' ? (245 * 1000 * seconds) / 8 : null;
	}

	let videoOptions = $derived(
		(info?.videos ?? []).map((video) => ({
			value: video.id,
			label: video.label,
			hint: video.hint,
			side: playlist ? '' : about(videoBytes(video.qualities[0]))
		}))
	);
	let qualityOptions = $derived([
		{
			value: null,
			label: 'Best',
			hint: qualities[0] ? `the highest there is: ${heightLabel(qualities[0].height)}` : '',
			side: playlist ? '' : about(videoBytes(qualities[0]))
		},
		...qualities.map((quality) => ({
			value: quality.height,
			label: `${heightLabel(quality.height)}${quality.fps > 30 ? quality.fps : ''}`,
			hint: playlist ? 'or the highest under it' : '',
			side: about(videoBytes(quality))
		}))
	]);
	let audioOptions = $derived(
		AUDIO_FORMATS.map((format) => ({
			...format,
			side: playlist ? '' : about(audioBytes(format.value, null))
		}))
	);
	let kbpsOptions = $derived([
		{
			value: null,
			label: 'Best',
			hint: 'as good as it is there',
			side: playlist ? '' : about(audioBytes(options.audioFormat, null))
		},
		...kbpsChoices.map((rate) => ({
			value: rate,
			label: `${rate} kbps`,
			hint: rate >= 256 ? 'high' : rate >= 160 ? 'good' : 'smaller',
			side: playlist ? '' : about(audioBytes(options.audioFormat, rate))
		}))
	]);
	let itemOptions = $derived(
		playlist
			? [
					{ value: null, label: `All ${info.count || ''} videos`.replace('  ', ' ') },
					...[10, 25, 50]
						.filter((n) => info.count > n)
						.map((n) => ({ value: `1-${n}`, label: `The first ${n}` })),
					{ value: '1', label: 'Only the first' }
				]
			: []
	);
	/** How big it'd be, all of it, for the download button */
	let total = $derived(
		!info || playlist
			? ''
			: tab === 'video'
				? about(videoBytes(height ? qualities.find((q) => q.height === height) : qualities[0]))
				: about(audioBytes(options.audioFormat, kbps))
	);

	const isLink = (text) => /^https?:\/\/\S+$/i.test(text.trim());

	/** Where a link says to start (YouTube's and Twitch's "?t=1h2m3s", "&t=90", "#t=90"), s */
	function startIn(url) {
		try {
			const address = new URL(url);
			const value =
				address.searchParams.get('t') ??
				address.searchParams.get('start') ??
				new URLSearchParams(address.hash.slice(1)).get('t');
			if (!value) return 0;
			if (/^\d+(\.\d+)?s?$/.test(value)) return parseFloat(value);
			const parts = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
			return parts ? (+parts[1] || 0) * 3600 + (+parts[2] || 0) * 60 + (+parts[3] || 0) : 0;
		} catch {
			return 0;
		}
	}

	/** Where the link said to start (s; 0: it didn't) */
	let fromLink = $state(0);

	async function look(text = link) {
		const url = text.trim();
		if (!isLink(url) || url === looked) return;
		looked = url;
		offered = null;
		used.add(url);
		found = { state: 'loading' };
		try {
			const result = await lookUp(url, options.cookies);
			if (looked !== url) return;
			found = { state: 'ready', info: result };
			// (a link to a time in it: only the part from there, ready to be changed)
			const at = result.kind === 'video' ? startIn(url) : 0;
			fromLink = at > 0 && at < result.duration - 1 ? at : 0;
			part = {
				on: fromLink > 0,
				start: fromLink,
				end: result.duration,
				exact: true
			};
			items = null;
		} catch (error) {
			if (looked !== url) return;
			const message = String(error?.message ?? error);
			if (message === 'Stopped') return;
			found = { state: 'failed', error: message };
			looked = '';
		}
	}

	/** Signed in as in another browser: a link that couldn't be looked at, looked at again */
	function signIn(value) {
		options.cookies = value;
		if (found.state === 'failed' && isLink(link)) void look();
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
		const audio = tab === 'audio';
		/** @type {[number, number][]} */
		const sections =
			part.on && !playlist && info.duration && (part.start > 0 || part.end < info.duration)
				? [[part.start, part.end]]
				: [];
		addDownload($state.snapshot(info), {
			url: info.url,
			kind: audio ? 'audio' : 'video',
			format: audio ? options.audioFormat : (choice?.container ?? 'mp4'),
			codec: audio ? null : (choice?.id ?? 'any'),
			height: audio ? null : height,
			audioKbps: audio ? kbps : null,
			sections,
			exactCuts: part.exact,
			sponsorblock: youtube && options.sponsorblock && !sections.length,
			playlist,
			playlistItems: playlist ? items : null,
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

	const short = (seconds) => clock(seconds).replace(/\.\d$/, '');

	function summary(job) {
		const r = job.request;
		const what =
			r.kind === 'audio'
				? `${AUDIO_FORMATS.find((f) => f.value === r.format)?.label ?? r.format}${r.audioKbps ? ` · ${r.audioKbps} kbps` : ''}`
				: `${job.info.videos.find((v) => v.id === r.codec)?.label ?? r.format.toUpperCase()}${r.height ? ` · ${heightLabel(r.height)}` : ''}`;
		const cut = r.sections.length ? ` · ${short(r.sections[0][0])}–${short(r.sections[0][1])}` : '';
		const videos = !r.playlist
			? ''
			: r.playlistItems === '1'
				? ' · the first video'
				: r.playlistItems
					? ` · the first ${r.playlistItems.slice(2)} videos`
					: ` · ${job.info.count} videos`;
		return `${what}${cut}${videos}`;
	}

	/** What a download is doing now */
	function doing(job) {
		if (job.phase !== 'download') return `${PHASES[job.phase] ?? 'Finishing'}…`;
		const of = job.count > 1 && job.index ? `Video ${job.index} of ${job.count}` : '';
		// (a part: FFmpeg cuts it out of the stream, without a share to tell)
		if (job.percent === null)
			return [of, job.request.sections.length ? 'Cutting out the part…' : 'Downloading…']
				.filter(Boolean)
				.join(' · ');
		const what =
			job.request.kind === 'video' && job.stream === 'audio'
				? 'Downloading the sound'
				: 'Downloading';
		return [of, `${what} · ${Math.round(job.percent)}%`, job.speed, job.eta && `${job.eta} left`]
			.filter(Boolean)
			.join(' · ');
	}

	// --- A link on the clipboard: offered (not used until it's clicked) ----------------------

	/** @type {string | null} */
	let offered = $state(null);

	async function offerClipboard() {
		if (link.trim() || found.state !== 'idle') return;
		try {
			const text = await invoke('clipboard_link');
			if (typeof text !== 'string' || !isLink(text) || used.has(text.trim())) return;
			if (!link.trim() && found.state === 'idle') offered = text.trim();
		} catch {
			// (no clipboard here: nothing offered)
		}
	}

	function useOffered() {
		if (!offered) return;
		link = offered;
		void look(offered);
	}

	function dismissOffered() {
		if (offered) used.add(offered);
		offered = null;
	}

	/** A link, short: its site and the start of its path */
	function shortLink(url) {
		try {
			const address = new URL(url);
			const rest = address.pathname + address.search;
			return `${address.hostname.replace(/^www\./, '')}${rest.length > 32 ? `${rest.slice(0, 31)}…` : rest}`;
		} catch {
			return url;
		}
	}

	onMount(() => {
		void ensureTools();
		void checkFiles();
		void offerClipboard();
		// (copied in the browser, back in Stosufy: offered then)
		const focused = () => void offerClipboard();
		window.addEventListener('focus', focused);
		return () => window.removeEventListener('focus', focused);
	});
</script>

<div class="relative min-h-full pb-12">
	<!-- Header -->
	<div class="relative">
		<div class="absolute inset-0 overflow-hidden">
			<div
				class="absolute inset-0 opacity-60"
				style="background: linear-gradient(120deg, #e11d48, #7c3aed 55%, transparent)"
			></div>
			<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent"></div>
		</div>
		<div class="relative px-8 pt-7 pb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
			<div class="min-w-0">
				<h1 class="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
					<span class="icon-[mingcute--download-3-line] size-8"></span>Downloader
				</h1>
				<p class="mt-1 text-sm text-white/70">
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
				<Dropdown
					label="Signed in as"
					icon="icon-[mingcute--user-3-line]"
					options={BROWSERS}
					value={options.cookies}
					onchange={signIn}
				/>
				<button
					class="h-10 px-3 flex items-center gap-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-sm font-semibold cursor-pointer transition"
					title="Where the downloads are: Stosufy/Downloads"
					onclick={() => show()}
				>
					<span class="icon-[mingcute--folder-open-line] size-4 text-white/55"></span>
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

		{#if offered && found.state === 'idle' && !link.trim()}
			<div
				class="-mt-1 flex flex-wrap items-center gap-2 text-sm"
				role="group"
				aria-label="Link on the clipboard"
				transition:fade={{ duration: 120 }}
			>
				<span class="icon-[mingcute--clipboard-line] size-4 text-white/45 shrink-0"></span>
				<span class="text-white/55">On the clipboard:</span>
				<button
					class="h-8 max-w-full px-3 flex items-center gap-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-100 font-semibold cursor-pointer transition"
					title={offered}
					onclick={useOffered}
				>
					<span class="truncate">{shortLink(offered)}</span>
					<span class="shrink-0 text-rose-200/80">· Use it</span>
				</button>
				<button
					class="size-7 grid place-items-center rounded-full text-white/40 hover:text-white hover:bg-white/10 cursor-pointer transition"
					aria-label="Not this link"
					title="Not this link"
					onclick={dismissOffered}
				>
					<span class="icon-[mingcute--close-line] size-3.5"></span>
				</button>
			</div>
		{/if}

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
							{info.site}{playlist ? ' · Playlist' : ''}{info.live ? ' · Live' : ''}
						</p>
						<h2 class="text-lg font-bold leading-snug line-clamp-2" title={info.title}>
							{info.title}
						</h2>
						<p class="mt-0.5 text-sm text-white/60">
							{[
								info.uploader,
								playlist ? `${info.count} videos` : info.duration ? short(info.duration) : null
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
					<div class="flex flex-wrap items-center gap-2">
						<div class="h-10 p-1 flex rounded-xl bg-black/30" role="tablist" aria-label="What">
							{#each [['video', 'Video', 'icon-[mingcute--video-line]'], ['audio', 'Sound', 'icon-[mingcute--music-2-line]']] as [id, text, icon] (id)}
								<button
									class="px-3 flex items-center gap-1.5 rounded-lg text-sm font-bold cursor-pointer transition disabled:opacity-35 disabled:cursor-default {tab ===
									id
										? 'bg-white text-black'
										: 'text-white/70 hover:text-white enabled:hover:bg-white/10'}"
									role="tab"
									aria-selected={tab === id}
									disabled={id === 'video' && !info.video}
									title={id === 'video' && !info.video ? 'There is only sound here' : ''}
									onclick={() => (options.tab = id)}
								>
									<span class="{icon} size-4"></span>
									{text}
								</button>
							{/each}
						</div>
						{#if tab === 'video'}
							<Dropdown
								label="Video format"
								icon="icon-[mingcute--film-line]"
								sideOnButton={false}
								options={videoOptions}
								value={choice?.id}
								onchange={(value) => (options.codec = value)}
							/>
							<Dropdown
								label="Quality"
								icon="icon-[mingcute--sparkles-line]"
								options={qualityOptions}
								value={height}
								onchange={(value) => (options.height = value)}
							/>
						{:else}
							<Dropdown
								label="Sound format"
								icon="icon-[mingcute--music-2-line]"
								sideOnButton={!kbpsChoices.length}
								options={audioOptions}
								value={options.audioFormat}
								onchange={(value) => (options.audioFormat = value)}
							/>
							{#if kbpsChoices.length}
								<Dropdown
									label="Sound quality"
									icon="icon-[mingcute--sparkles-line]"
									options={kbpsOptions}
									value={kbps}
									onchange={(value) => (options.audioKbps = value)}
								/>
							{/if}
						{/if}
						{#if playlist}
							<Dropdown
								label="Which videos"
								icon="icon-[mingcute--playlist-line]"
								options={itemOptions}
								value={items}
								onchange={(value) => (items = value)}
							/>
						{/if}
					</div>

					{#if (!playlist && info.duration) || (youtube && !part.on)}
						<div class="flex flex-col gap-2">
							{#if !playlist && info.duration}
								<label class="flex items-center gap-2 text-sm">
									<input type="checkbox" class="accent-rose-400 size-4" bind:checked={part.on} />
									Only a part of it
									<span class="text-white/45">
										{fromLink && part.on && part.start === fromLink
											? `(from ${short(fromLink)}, where the link starts)`
											: '(only that part is downloaded)'}
									</span>
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
					{/if}

					<div>
						<button
							class="h-11 px-6 flex items-center gap-2 rounded-full text-base font-bold bg-rose-500 hover:bg-rose-400 text-white cursor-pointer transition"
							onclick={start}
						>
							<span class="icon-[mingcute--download-3-line] size-5"></span>
							Download
							{#if total}
								<span class="text-sm font-semibold text-white/75 tabular-nums">{total}</span>
							{/if}
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
								{#if job.status === 'done' && job.note}
									<p class="flex items-center gap-1 text-xs text-amber-200/90" title={job.note}>
										<span class="icon-[mingcute--information-line] size-3.5 shrink-0"></span>
										<span class="truncate">{job.note}</span>
									</p>
								{/if}
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
									<p class="text-xs text-white/60 tabular-nums truncate" title={doing(job)}>
										{doing(job)}
									</p>
								</div>
							{:else if job.status === 'done' && job.missing}
								<span
									class="flex items-center gap-1.5 text-white/50"
									title="It's not in Stosufy/Downloads any more"
								>
									<span class="icon-[mingcute--file-unknown-line] size-4 shrink-0"></span>
									Moved or deleted
								</span>
								<button
									class="h-8 px-3 rounded-full font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
									onclick={() => retry(job.id)}
								>
									Download again
								</button>
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
