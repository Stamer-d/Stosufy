<script>
	// Wrapped as a story: one thing at a time, full screen, ending with the picture to share.
	// Click the right side (or →) for the next, the left (←) for the one before, Esc to leave.
	import { onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { wrappedImage, saveWrappedImage, copyWrappedImage } from '#lib/wrappedImage.ts';
	import BeatmapBackground from './BeatmapBackground.svelte';
	import SongCover from './SongCover.svelte';
	import Triangles from './Triangles.svelte';

	/**
	 * `share`: starts at the end, with the picture
	 * @type {{ recap: import('#lib/wrapped.ts').Recap, period: string, username?: string, share?: boolean, onclose: () => void }}
	 */
	let { recap, period, username = '', share = false, onclose } = $props();

	/** How long a page shows before the next (ms) */
	const PAGE_TIME = 7000;

	let top = $derived(recap.topSongs[0] ?? null);
	let busiest = $derived(recap.hours.indexOf(Math.max(...recap.hours)));
	const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
	let listener = $derived(
		busiest < 5
			? 'a night owl'
			: busiest < 11
				? 'an early bird'
				: busiest < 17
					? 'an afternoon listener'
					: busiest < 22
						? 'an evening listener'
						: 'a night owl'
	);
	let minutes = $derived(Math.round(recap.seconds / 60));
	let hours = $derived(Math.round(recap.seconds / 3600));
	const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

	let pages = $derived(
		[
			'intro',
			'minutes',
			top && 'song',
			recap.topArtists.length && 'artists',
			(recap.topGenres.length || recap.topSources.length) && 'sound',
			'clock',
			(recap.streak > 1 || recap.onRepeat || recap.bestFind) && 'facts',
			'share'
		].filter(Boolean)
	);
	let index = $state(untrack(() => (share ? pages.length - 1 : 0)));
	let current = $derived(pages[index]);
	let started = $state(performance.now());
	let progress = $state(0);

	const go = (to) => {
		index = Math.max(0, Math.min(pages.length - 1, to));
		started = performance.now();
		progress = 0;
	};
	const next = () => (index === pages.length - 1 ? null : go(index + 1));
	const previous = () => go(index - 1);

	// The minutes count up when their page shows
	let counted = $state(0);
	$effect(() => {
		if (current !== 'minutes') return;
		const from = performance.now();
		let frame;
		const step = () => {
			const t = Math.min(1, (performance.now() - from) / 1800);
			counted = Math.round(minutes * (1 - (1 - t) ** 3));
			if (t < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	});

	// The picture to share, made once the story starts
	let picture = $state(null);
	let pictureUrl = $state(null);
	onMount(() => {
		keybindsPaused.set(true);
		wrappedImage({ recap, period, username })
			.then((blob) => {
				picture = blob;
				pictureUrl = URL.createObjectURL(blob);
			})
			.catch((error) => console.error('Could not make the Wrapped picture:', error));
		let frame;
		const tick = () => {
			// (the last page stays)
			if (index < pages.length - 1) {
				progress = Math.min(1, (performance.now() - started) / PAGE_TIME);
				if (progress >= 1) next();
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			keybindsPaused.set(false);
			if (pictureUrl) URL.revokeObjectURL(pictureUrl);
		};
	});

	function keydown(event) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight' || event.key === ' ') next();
		else if (event.key === 'ArrowLeft') previous();
		else return;
		event.preventDefault();
	}

	function tap(event) {
		if (event.target.closest('button, a')) return;
		const box = event.currentTarget.getBoundingClientRect();
		if (event.clientX - box.left < box.width / 3) previous();
		else next();
	}

	let saving = $state(false);
	async function save() {
		if (!picture) return;
		saving = true;
		try {
			const file = await saveWrappedImage(picture, period);
			showToast(`Saved your Wrapped to ${file}`, 'icon-[mingcute--download-2-line]');
		} catch (error) {
			console.error('Could not save the Wrapped picture:', error);
			showToast("Couldn't save the picture", 'icon-[mingcute--warning-line]');
		} finally {
			saving = false;
		}
	}
	async function copy() {
		if (!picture) return;
		try {
			await copyWrappedImage(picture);
			showToast('Copied: paste it into Discord', 'icon-[mingcute--copy-2-line]');
		} catch (error) {
			console.error('Could not copy the Wrapped picture:', error);
			showToast("Couldn't copy the picture", 'icon-[mingcute--warning-line]');
		}
	}
</script>

<svelte:window onkeydown={keydown} />

<div
	class="fixed inset-0 z-50 bg-black/80 backdrop-blur grid place-items-center"
	transition:fade={{ duration: 200 }}
	role="dialog"
	aria-modal="true"
	aria-label="Your Wrapped story"
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="relative h-[min(92vh,52rem)] aspect-[9/16] rounded-2xl overflow-hidden bg-gradient-to-br from-primary-300 via-[#1a1530] to-[#0d0d12] shadow-2xl shadow-black select-none cursor-pointer"
		onclick={tap}
	>
		<Triangles count={16} seed={index + 3} />

		<!-- How far the story is -->
		<div class="absolute top-3 inset-x-3 z-20 flex gap-1">
			{#each pages as page, i (page)}
				<span class="flex-1 h-1 rounded-full bg-white/25 overflow-hidden">
					<span
						class="block h-full bg-white"
						style="width: {i < index ? 100 : i === index ? progress * 100 : 0}%"
					></span>
				</span>
			{/each}
		</div>
		<button
			class="absolute top-6 right-3 z-20 size-9 grid place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Close"
			onclick={onclose}
		>
			<span class="icon-[mingcute--close-line] size-5"></span>
		</button>

		{#key current}
			<div
				class="absolute inset-0 flex flex-col justify-center gap-4 px-8 pt-16 pb-10"
				in:fly={{ y: 24, duration: 450 }}
			>
				{#if current === 'intro'}
					<p class="text-sm font-bold uppercase tracking-wide text-white/70">
						{username ? `${username}'s` : 'Your'} Stosufy Wrapped
					</p>
					<h2 class="text-5xl font-extrabold leading-tight">{period}</h2>
					<p class="text-lg text-white/80">Let's look at what you listened to.</p>
				{:else if current === 'minutes'}
					<p class="text-lg text-white/80">You listened to</p>
					<p class="text-7xl font-extrabold tabular-nums leading-none">
						{counted.toLocaleString()}
					</p>
					<p class="text-2xl font-bold">minutes of music</p>
					<p class="text-white/70">
						{hours >= 1 ? `That's ${hours} hours, ` : ''}{recap.songs} songs, {recap.days}
						{recap.days === 1 ? 'day' : 'days'} with music.
					</p>
				{:else if current === 'song'}
					<div class="absolute inset-0 -z-10 opacity-40">
						<BeatmapBackground
							setId={top.song.setId}
							mapId={top.song.mapId}
							title={top.song.title}
							class="absolute inset-0"
							imageClass="blur-sm scale-110"
						/>
					</div>
					<p class="text-lg text-white/80">Your top song</p>
					<SongCover
						setId={top.song.setId}
						track={top.song.track}
						title={top.song.title}
						class="size-56 rounded-xl shadow-2xl shadow-black/50"
					/>
					<p class="text-4xl font-extrabold leading-tight">{top.song.title}</p>
					<p class="text-xl text-white/80">{top.song.artist}</p>
					<p class="text-white/70">You played it {times(top.plays)}.</p>
				{:else if current === 'artists'}
					<p class="text-lg text-white/80">Your top artists</p>
					<ol class="flex flex-col gap-3">
						{#each recap.topArtists.slice(0, 5) as artist, i (artist.name)}
							<li class="flex items-center gap-4" in:fly={{ x: 30, delay: 150 + i * 120 }}>
								<span class="w-6 text-2xl font-extrabold text-white/50">{i + 1}</span>
								<SongCover
									setId={artist.top.setId}
									track={artist.top.track}
									title={artist.top.title}
									class="size-14 rounded-full"
								/>
								<span class="min-w-0">
									<span class="block text-2xl font-bold truncate">{artist.name}</span>
									<span class="block text-sm text-white/60">{artist.plays} plays</span>
								</span>
							</li>
						{/each}
					</ol>
				{:else if current === 'sound'}
					<p class="text-lg text-white/80">Your sound</p>
					{#if recap.topGenres[0]}
						<p class="text-5xl font-extrabold leading-tight">{recap.topGenres[0].name}</p>
						<p class="text-white/70">
							{Math.round((recap.topGenres[0].plays / recap.plays) * 100)}% of your plays
						</p>
					{/if}
					{#if recap.topSources[0]}
						<p class="mt-6 text-lg text-white/80">Most of all from</p>
						<p class="text-3xl font-extrabold leading-tight">{recap.topSources[0].name}</p>
					{/if}
				{:else if current === 'clock'}
					<p class="text-lg text-white/80">You're</p>
					<p class="text-5xl font-extrabold leading-tight">{listener}</p>
					<p class="text-white/70">You listen most around {hourLabel(busiest)}.</p>
					<div class="mt-4 h-32 flex items-end gap-0.5" aria-hidden="true">
						{#each recap.hours as value, hour (hour)}
							<span
								class="flex-1 rounded-t {hour === busiest ? 'bg-white' : 'bg-white/35'}"
								style="height: {value ? Math.max(3, (value / Math.max(...recap.hours)) * 100) : 0}%"
							></span>
						{/each}
					</div>
				{:else if current === 'facts'}
					<p class="text-lg text-white/80">And also</p>
					<div class="flex flex-col gap-5">
						{#if recap.streak > 1}
							<p class="text-2xl font-bold">
								<span class="text-4xl font-extrabold">{recap.streak}</span> days in a row with music
							</p>
						{/if}
						{#if recap.onRepeat}
							<p class="text-2xl font-bold">
								"{recap.onRepeat.song.title}" on repeat: {times(recap.onRepeat.plays)} in one day
							</p>
						{/if}
						{#if recap.bestFind}
							<p class="text-2xl font-bold">
								{recap.newSongs} new songs, the best: "{recap.bestFind.song.title}"
							</p>
						{/if}
					</div>
				{:else if current === 'share'}
					<p class="text-lg text-white/80 text-center">Share it</p>
					{#if pictureUrl}
						<img
							src={pictureUrl}
							alt="Your Wrapped: {minutes} minutes, top song {top?.song.title ?? ''}"
							class="w-full rounded-lg shadow-2xl shadow-black/50"
						/>
					{:else}
						<div class="w-full aspect-[4/5] rounded-lg bg-white/10 grid place-items-center">
							<span class="icon-[svg-spinners--ring-resize] size-8"></span>
						</div>
					{/if}
					<div class="flex gap-2 justify-center">
						<button
							class="flex items-center gap-2 px-4 h-10 rounded-full bg-white text-black text-sm font-bold cursor-pointer hover:bg-white/90 disabled:opacity-50"
							disabled={!picture}
							onclick={copy}
						>
							<span class="icon-[mingcute--copy-2-line] size-4"></span>
							Copy
						</button>
						<button
							class="flex items-center gap-2 px-4 h-10 rounded-full bg-white/15 text-sm font-bold cursor-pointer hover:bg-white/25 disabled:opacity-50"
							disabled={!picture || saving}
							onclick={save}
						>
							<span class="icon-[mingcute--download-2-line] size-4"></span>
							Save
						</button>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>
