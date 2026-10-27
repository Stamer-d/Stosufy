<script>
	// Wrapped as a story, on the whole screen as on Instagram: one thing at a time, on by
	// itself. Tap right for the next, left for the one before, hold to stop it, swipe down to
	// leave. It ends with a picture to share.
	import { onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { showToast } from '../lib/stores/toast';
	import { haptic } from './haptics';
	import { swipe } from './gestures';
	import Triangles from '../lib/components/Triangles.svelte';
	import SongCover from '../lib/components/SongCover.svelte';

	/** @type {{ recap: import('../lib/wrapped').Recap, period: string, username?: string, onclose: () => void }} */
	let { recap, period, username = '', onclose } = $props();

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
	const backdrop = (setId) => `https://assets.ppy.sh/beatmaps/${setId}/covers/list@2x.jpg`;

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
	let index = $state(0);
	let current = $derived(pages[index]);
	let progress = $state(0);
	/** Held down: it waits */
	let held = $state(false);
	let shownFor = 0;

	const go = (to) => {
		index = Math.max(0, Math.min(pages.length - 1, to));
		shownFor = 0;
		progress = 0;
	};
	const next = () => (index === pages.length - 1 ? onclose() : go(index + 1));
	const previous = () => go(index - 1);

	// The minutes count up when their page shows
	let counted = $state(0);
	$effect(() => {
		if (current !== 'minutes') return;
		const total = untrack(() => minutes);
		const from = performance.now();
		let frame;
		const step = () => {
			const t = Math.min(1, (performance.now() - from) / 1800);
			counted = Math.round(total * (1 - (1 - t) ** 3));
			if (t < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	});

	let picture = $state(null);
	let pictureUrl = $state(null);
	onMount(() => {
		makePicture()
			.then((blob) => {
				picture = blob;
				pictureUrl = URL.createObjectURL(blob);
			})
			.catch((error) => console.error('Could not make the Wrapped picture:', error));
		let frame;
		let last = performance.now();
		const tick = (now) => {
			const passed = now - last;
			last = now;
			// (the last page stays; held, the time stands)
			if (!held && index < pages.length - 1) {
				shownFor += passed;
				progress = Math.min(1, shownFor / PAGE_TIME);
				if (progress >= 1) next();
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		// (what's behind doesn't scroll)
		document.documentElement.style.overflow = 'hidden';
		return () => {
			cancelAnimationFrame(frame);
			document.documentElement.style.overflow = '';
			if (pictureUrl) URL.revokeObjectURL(pictureUrl);
		};
	});

	// A tap: left third back, else on. Held longer than a tap: it only waited.
	let downAt = 0;
	let holdTimer = null;
	function down(event) {
		if (event.target.closest('button, a')) return;
		downAt = performance.now();
		holdTimer = setTimeout(() => (held = true), 200);
	}
	function up(event) {
		clearTimeout(holdTimer);
		const wasHeld = held;
		held = false;
		if (!downAt || event.target.closest('button, a')) return;
		const short = performance.now() - downAt < 250;
		downAt = 0;
		if (wasHeld || !short) return;
		haptic();
		if (event.clientX < window.innerWidth / 3) previous();
		else next();
	}
	function cancel() {
		clearTimeout(holdTimer);
		held = false;
		downAt = 0;
	}

	// --- The picture to share --------------------------------------------------------------

	function loadImage(url) {
		return new Promise((resolve) => {
			const image = new Image();
			image.crossOrigin = 'anonymous';
			image.onload = () => resolve(image);
			image.onerror = () => resolve(null);
			image.src = url;
		});
	}

	/** The story's sum on one picture (1080×1350), for Instagram, WhatsApp, Discord… */
	async function makePicture() {
		const W = 1080;
		const H = 1350;
		const canvas = document.createElement('canvas');
		canvas.width = W;
		canvas.height = H;
		const c = canvas.getContext('2d');
		const accent =
			getComputedStyle(document.documentElement).getPropertyValue('--color-primary-300').trim() ||
			'#7c3aed';
		const sky = c.createLinearGradient(0, 0, W, H);
		sky.addColorStop(0, accent);
		sky.addColorStop(0.55, '#1a1530');
		sky.addColorStop(1, '#0d0d12');
		c.fillStyle = sky;
		c.fillRect(0, 0, W, H);
		// osu!'s triangles
		c.fillStyle = 'rgba(255,255,255,0.05)';
		for (let i = 0; i < 14; i++) {
			const x = ((i * 397) % W) - 60;
			const y = ((i * 613) % H) - 60;
			const s = 120 + ((i * 89) % 220);
			c.beginPath();
			c.moveTo(x, y + s);
			c.lineTo(x + s / 2, y);
			c.lineTo(x + s, y + s);
			c.fill();
		}
		const font = getComputedStyle(document.body).fontFamily;
		const text = (value, x, y, size, weight = 800, color = '#fff', maxWidth = W - 160) => {
			c.font = `${weight} ${size}px ${font}`;
			c.fillStyle = color;
			let shown = String(value);
			while (c.measureText(shown).width > maxWidth && shown.length > 3)
				shown = shown.slice(0, -2).trimEnd() + '…';
			if (shown !== String(value) && !shown.endsWith('…')) shown += '…';
			c.fillText(shown, x, y);
		};
		text(
			`${username ? `${username}'s` : 'My'} Stosufy Wrapped`.toUpperCase(),
			80,
			130,
			34,
			700,
			'rgba(255,255,255,0.75)'
		);
		text(period, 80, 210, 76);
		text(minutes.toLocaleString(), 80, 360, 150);
		text('minutes of music', 80, 425, 44, 700);
		if (top) {
			const cover = await loadImage(backdrop(top.song.setId));
			let x = 80;
			if (cover) {
				c.save();
				c.beginPath();
				c.roundRect(80, 500, 220, 220, 24);
				c.clip();
				const side = Math.min(cover.width, cover.height);
				c.drawImage(
					cover,
					(cover.width - side) / 2,
					(cover.height - side) / 2,
					side,
					side,
					80,
					500,
					220,
					220
				);
				c.restore();
				x = 340;
			}
			text('TOP SONG', x, 560, 30, 700, 'rgba(255,255,255,0.7)', W - x - 80);
			text(top.song.title, x, 625, 54, 800, '#fff', W - x - 80);
			text(top.song.artist, x, 685, 38, 500, 'rgba(255,255,255,0.8)', W - x - 80);
		}
		let y = 830;
		if (recap.topArtists.length) {
			text('TOP ARTISTS', 80, y, 30, 700, 'rgba(255,255,255,0.7)');
			recap.topArtists.slice(0, 5).forEach((artist, i) => {
				text(`${i + 1}  ${artist.name}`, 80, y + 64 + i * 60, 42, 700, '#fff', W / 2 + 120);
			});
		}
		if (recap.topGenres[0]) {
			text('SOUND', 720, y, 30, 700, 'rgba(255,255,255,0.7)', 300);
			text(recap.topGenres[0].name, 720, y + 64, 44, 800, '#fff', 300);
		}
		text('stosufy', 80, H - 70, 34, 800, 'rgba(255,255,255,0.6)');
		return new Promise((resolve, reject) =>
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), 'image/png')
		);
	}

	async function share() {
		if (!picture) return;
		const file = new File([picture], `stosufy-wrapped.png`, { type: 'image/png' });
		if (navigator.canShare?.({ files: [file] })) {
			await navigator
				.share({ files: [file], title: 'My Stosufy Wrapped' })
				.catch(
					(error) =>
						error?.name !== 'AbortError' &&
						showToast("Couldn't share it", 'icon-[mingcute--warning-line]')
				);
			return;
		}
		const link = document.createElement('a');
		link.href = pictureUrl;
		link.download = file.name;
		link.click();
		showToast('Saved the picture', 'icon-[mingcute--download-2-line]');
	}
</script>

<div
	class="fixed inset-0 z-50 bg-black select-none overflow-hidden"
	transition:fade={{ duration: 200 }}
	role="dialog"
	aria-modal="true"
	aria-label="Your Wrapped story"
	use:swipe={{ axis: 'y', only: 1, onswipe: onclose }}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute inset-0 bg-gradient-to-br from-primary-300 via-[#1a1530] to-[#0d0d12]"
		onpointerdown={down}
		onpointerup={up}
		onpointercancel={cancel}
		oncontextmenu={(e) => e.preventDefault()}
	>
		{#if current === 'song' && top}
			<img
				src={backdrop(top.song.setId)}
				alt=""
				class="absolute inset-0 size-full object-cover opacity-30 blur-xl scale-125"
				transition:fade
			/>
		{/if}
		<Triangles count={16} seed={index + 3} />

		<!-- How far the story is -->
		<div
			class="absolute top-[calc(env(safe-area-inset-top)+0.5rem)] inset-x-3 z-20 flex gap-1 transition-opacity {held
				? 'opacity-0'
				: ''}"
		>
			{#each pages as page, i (page)}
				<span class="flex-1 h-[3px] rounded-full bg-white/25 overflow-hidden">
					<span
						class="block h-full bg-white"
						style="width: {i < index ? 100 : i === index ? progress * 100 : 0}%"
					></span>
				</span>
			{/each}
		</div>
		<div
			class="absolute top-[calc(env(safe-area-inset-top)+1.25rem)] inset-x-3 z-20 flex items-center justify-between transition-opacity {held
				? 'opacity-0'
				: ''}"
		>
			<p class="pl-1 text-sm font-semibold text-white/80">Stosufy Wrapped · {period}</p>
			<button
				class="size-11 grid place-items-center rounded-full text-white/90"
				aria-label="Close"
				onclick={onclose}
			>
				<span class="icon-[mingcute--close-line] size-6"></span>
			</button>
		</div>

		{#key current}
			<div
				class="absolute inset-0 flex flex-col justify-center gap-4 px-7 pt-[calc(env(safe-area-inset-top)+4rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]"
				in:fly={{ y: 24, duration: 450 }}
			>
				{#if current === 'intro'}
					<p class="text-sm font-bold uppercase tracking-wide text-white/70">
						{username ? `${username}'s` : 'Your'} Stosufy Wrapped
					</p>
					<h2 class="text-5xl font-extrabold leading-tight">{period}</h2>
					<p class="text-lg text-white/80">Let's look at what you listened to.</p>
					<p class="mt-8 text-sm text-white/50">Tap to go on · hold to stop</p>
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
				{:else if current === 'song' && top}
					<p class="text-lg text-white/80">Your top song</p>
					<SongCover
						setId={top.song.setId}
						track={top.song.track}
						title={top.song.title}
						class="w-full max-w-72 aspect-square rounded-xl shadow-2xl shadow-black/50"
						large
					/>
					<p class="text-4xl font-extrabold leading-tight line-clamp-3">{top.song.title}</p>
					<p class="text-xl text-white/80">{top.song.artist}</p>
					<p class="text-white/70">You played it {times(top.plays)}.</p>
				{:else if current === 'artists'}
					<p class="text-lg text-white/80">Your top artists</p>
					<ol class="flex flex-col gap-4">
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
					<div class="mt-4 h-36 flex items-end gap-0.5" aria-hidden="true">
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
							class="mx-auto w-full max-w-[22rem] rounded-lg shadow-2xl shadow-black/50"
						/>
					{:else}
						<div
							class="mx-auto w-full max-w-[22rem] aspect-[4/5] rounded-lg bg-white/10 grid place-items-center"
						>
							<span class="icon-[svg-spinners--ring-resize] size-8"></span>
						</div>
					{/if}
					<div class="flex gap-2 justify-center">
						<button
							class="flex items-center gap-2 px-5 h-11 rounded-full bg-white text-black font-bold disabled:opacity-50"
							disabled={!picture}
							onclick={share}
						>
							<span class="icon-[mingcute--share-forward-line] size-5"></span>
							Share
						</button>
						<button
							class="flex items-center gap-2 px-5 h-11 rounded-full bg-white/15 font-bold"
							onclick={() => go(0)}
						>
							<span class="icon-[mingcute--refresh-2-line] size-5"></span>
							Again
						</button>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>
