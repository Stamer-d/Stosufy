<script>
	// The Dash mode's menu: the songs on the left, the level of the one that plays on the right
	// (its difficulty, what it's made of, how far you got) with the big Play button, and the
	// settings along the top.
	import { fade, fly } from 'svelte/transition';
	import DashSongs from './DashSongs.svelte';
	import DashSoundMenu from './DashSoundMenu.svelte';
	import DashModesMenu from './DashModesMenu.svelte';
	import SongCover from '../SongCover.svelte';
	import { DIFFICULTIES } from '#lib/dash/generate.ts';
	import { ICONS, spritesUrl } from '#lib/dash/render.ts';
	import { ATLAS, SPRITES } from '#lib/dash/sprites.ts';
	import { modesMark, dashModes } from '#lib/dash/modes.ts';

	/**
	 * @type {{
	 *   screen: string,
	 *   message?: string,
	 *   game: import("#lib/dash/game.ts").DashGame | null,
	 *   song: any,
	 *   difficulty: import("#lib/dash/generate.ts").Difficulty,
	 *   iconIndex: number,
	 *   practice: boolean,
	 *   autoCheckpoints: boolean,
	 *   best: { normal: number, practice: number, attempts: number },
	 *   exact?: boolean,
	 *   checkpointKeys: { place: string, remove: string },
	 *   songs?: any,
	 *   onplay: (auto: boolean) => void,
	 *   onpractice: () => void,
	 *   onexit: () => void
	 * }}
	 */
	let {
		screen,
		message = '',
		game,
		song,
		difficulty = $bindable(),
		iconIndex = $bindable(),
		practice,
		autoCheckpoints = $bindable(),
		best,
		exact = false,
		checkpointKeys,
		songs = $bindable(),
		onplay,
		onpractice,
		onexit
	} = $props();

	const DIFFICULTY = {
		easy: {
			label: 'Easy',
			color: '#38bdf8',
			about: 'Slow and roomy: cube, ship, ball and UFO'
		},
		normal: {
			label: 'Normal',
			color: '#a3e635',
			about: 'Every basic part, a bit faster in the chorus'
		},
		hard: {
			label: 'Hard',
			color: '#fbbf24',
			about: 'Fast and busy: every kind of part, orb chains, small parts'
		},
		insane: {
			label: 'Insane',
			color: '#fb7185',
			about: 'Tight timing, narrow tunnels and the top speeds in the drops'
		},
		extreme: {
			label: 'Extreme',
			color: '#d946ef',
			about: 'Demon level: very little room per click, 2–3 block tunnels, short parts'
		}
	};

	const MODES = {
		cube: { label: 'Cube', color: '#60a5fa' },
		robot: { label: 'Robot', color: '#a78bfa' },
		ship: { label: 'Ship', color: '#f472b6' },
		ball: { label: 'Ball', color: '#fb923c' },
		ufo: { label: 'UFO', color: '#2dd4bf' },
		wave: { label: 'Wave', color: '#22d3ee' },
		swing: { label: 'Swing', color: '#facc15' },
		spider: { label: 'Spider', color: '#c084fc' }
	};

	let accent = $derived(DIFFICULTY[difficulty].color);
	let level = $derived(game?.level ?? null);

	/** What the level is made of: its parts along the song, and what there is of each */
	let facts = $derived.by(() => {
		if (!level) return null;
		const sections = level.world.sections;
		const span = Math.max(1, level.end - level.start);
		const parts = sections.map((s) => ({
			mode: s.mode,
			mini: s.mini,
			kiai: s.kiai,
			left: ((s.start - level.start) / span) * 100,
			width: ((s.end - s.start) / span) * 100
		}));
		const modes = [...new Set(sections.map((s) => s.mode))];
		const seconds = Math.round(span / 1000);
		const top = Math.max(...sections.map((s) => s.speedIndex));
		return {
			parts,
			modes,
			length: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
			speed: ['0.5×', '1×', '2×', '3×', '4×'][top] ?? `${top}×`,
			count: sections.length
		};
	});

	const pct = (value) => `${Math.floor(value)}%`;
	const keyName = (code) => code.replace(/^Key/, '');

	/** An icon's picture out of the sprites, at a size (px) */
	function iconLook(icon, size) {
		const [x, y, w, h] = SPRITES[icon.sprite];
		const k = size / Math.max(w, h);
		return `width:${size}px;height:${size}px;background: url(${spritesUrl}) ${-x * k}px ${-y * k}px / ${ATLAS[0] * k}px ${ATLAS[1] * k}px no-repeat`;
	}
</script>

<div
	class="absolute inset-0 flex flex-col bg-gradient-to-b from-black/70 via-black/45 to-black/75 overflow-hidden"
	style="--accent: {accent}"
	transition:fade={{ duration: 150 }}
>
	<!-- The top: what this is, the settings, the way out -->
	<header class="flex items-center gap-3 px-6 pt-12 pb-3">
		<div class="flex items-center gap-3 mr-auto">
			<span
				class="grid place-items-center size-10 rounded-xl rotate-6 shadow-lg"
				style="background: {ICONS[iconIndex].primary}"
			>
				<span class="block -rotate-6" style={iconLook(ICONS[iconIndex], 30)}></span>
			</span>
			<div class="leading-none">
				<p class="text-2xl font-black tracking-[0.18em]">DASH</p>
				<p class="mt-1 text-xs text-white/50">Your songs as one-button levels</p>
			</div>
		</div>
		<DashModesMenu labelled />
		<DashSoundMenu labelled />
		<button
			class="flex items-center gap-2 h-10 pl-3 pr-4 rounded-full bg-white/10 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/15 cursor-pointer transition"
			title="Leave Dash (Esc)"
			onclick={onexit}
		>
			<span class="icon-[mingcute--close-line] size-5"></span>
			Leave
		</button>
	</header>

	<div class="flex-1 min-h-0 flex gap-5 px-6 pb-6 max-[820px]:flex-col max-[820px]:overflow-y-auto">
		<div class="w-[min(24rem,34vw)] max-[820px]:w-full max-[820px]:h-80 shrink-0 min-h-0">
			<DashSongs bind:this={songs} {difficulty} mark={modesMark($dashModes)} />
		</div>

		<!-- The level -->
		<section
			class="relative flex-1 min-w-0 flex flex-col rounded-3xl bg-black/55 backdrop-blur-xl ring-1 ring-white/12 shadow-2xl overflow-hidden"
		>
			<div
				class="absolute inset-x-0 top-0 h-48 opacity-30 pointer-events-none transition-colors duration-300"
				style="background: radial-gradient(120% 100% at 20% 0%, var(--accent), transparent 70%)"
			></div>

			{#if !song}
				<div class="flex-1 grid place-items-center p-8 text-center">
					<div class="flex flex-col items-center gap-3">
						<span class="icon-[mingcute--music-2-line] size-12 text-white/30"></span>
						<p class="text-lg font-semibold text-white/80">Choose a song</p>
						<p class="text-sm text-white/45">Its level is made from its beatmap and its sound.</p>
					</div>
				</div>
			{:else}
				<div class="relative flex-1 min-h-0 overflow-y-auto p-7 flex flex-col gap-6">
					<!-- The song -->
					<div class="flex items-center gap-5">
						{#key song.id}
							<SongCover
								setId={song.id}
								track={song.track ?? 0}
								title={song.title}
								class="size-28 rounded-2xl shrink-0 shadow-xl ring-1 ring-white/15"
							/>
						{/key}
						<div class="min-w-0 flex-1">
							<h2 class="text-2xl lg:text-3xl font-black leading-tight line-clamp-2">
								{level?.title || song.title}
							</h2>
							<p class="mt-1 text-white/65 truncate">{level?.artist || song.artist}</p>
							{#if level}
								<p class="mt-0.5 text-sm text-white/40 truncate">
									from “{level.version}” by {level.creator}
								</p>
							{/if}
						</div>
					</div>

					<!-- The difficulty -->
					<div>
						<div class="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Difficulty">
							{#each DIFFICULTIES as d, i (d)}
								{@const on = difficulty === d}
								<button
									class="group relative h-16 flex flex-col items-center justify-center gap-1.5 rounded-2xl cursor-pointer transition {on
										? 'bg-white/12 ring-2 scale-[1.03]'
										: 'bg-white/[0.04] ring-1 ring-white/8 hover:bg-white/[0.09]'}"
									style={on ? `--tw-ring-color: ${DIFFICULTY[d].color}` : ''}
									role="radio"
									aria-checked={on}
									title={DIFFICULTY[d].about}
									onclick={() => (difficulty = d)}
								>
									<span class="flex gap-0.5" aria-hidden="true">
										{#each DIFFICULTIES as _, k (k)}
											<span
												class="w-1.5 h-3 rounded-sm transition-colors"
												style="background: {k <= i
													? DIFFICULTY[d].color
													: 'rgba(255,255,255,0.12)'}; opacity: {on ? 1 : 0.55}"
											></span>
										{/each}
									</span>
									<span class="text-sm font-black {on ? 'text-white' : 'text-white/60'}"
										>{DIFFICULTY[d].label}</span
									>
								</button>
							{/each}
						</div>
						<p class="mt-2.5 text-center text-sm text-white/55">{DIFFICULTY[difficulty].about}</p>
					</div>

					{#if screen === 'error'}
						<div class="flex-1 grid place-items-center text-center">
							<div class="flex flex-col items-center gap-3">
								<span class="icon-[mingcute--warning-line] size-10 text-amber-300/70"></span>
								<p class="text-white/80">{message}</p>
								<p class="text-sm text-white/45">Choose another song on the left.</p>
							</div>
						</div>
					{:else if !level || !facts || screen === 'loading'}
						<div class="flex-1 grid place-items-center">
							<div class="flex flex-col items-center gap-4">
								<span class="relative grid place-items-center size-14">
									<span
										class="absolute inset-0 rounded-xl border-4 border-white/15 animate-spin [animation-duration:1.6s]"
										style="border-top-color: var(--accent)"
									></span>
								</span>
								<p class="text-lg font-semibold text-white/80">Building the level…</p>
								<p class="text-sm text-white/45">
									Listening to the song, then placing every jump on its beat
								</p>
							</div>
						</div>
					{:else}
						<!-- What it's made of -->
						<div in:fade={{ duration: 200 }}>
							<div
								class="relative h-5 rounded-full overflow-hidden bg-white/5 ring-1 ring-white/10"
								aria-label="The parts of the level along the song"
							>
								{#each facts.parts as part, i (i)}
									<span
										class="absolute inset-y-0 border-r border-black/40"
										style="left: {part.left}%; width: {part.width}%; background: {MODES[part.mode]
											.color}; opacity: {part.kiai ? 1 : 0.6}"
										title="{MODES[part.mode].label}{part.mini ? ' (small)' : ''}{part.kiai
											? ' · drop'
											: ''}"
									></span>
								{/each}
							</div>
							<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
								{#each facts.modes as mode (mode)}
									<span class="flex items-center gap-1.5 text-white/75">
										<span class="size-2.5 rounded-sm" style="background: {MODES[mode].color}"
										></span>
										{MODES[mode].label}
									</span>
								{/each}
							</div>
							<div class="mt-4 grid grid-cols-4 gap-2 text-center">
								{#each [['Length', facts.length], ['Clicks', level.clicks], ['Parts', facts.count], ['Top speed', facts.speed]] as [label, value] (label)}
									<div class="py-2.5 rounded-xl bg-white/[0.05]">
										<p class="text-lg font-black tabular-nums">{value}</p>
										<p class="text-[11px] font-bold uppercase tracking-wider text-white/40">
											{label}
										</p>
									</div>
								{/each}
							</div>
						</div>

						<!-- How far you got -->
						<div class="flex flex-col gap-3">
							{#each [{ label: 'Normal mode', value: best.normal, color: 'var(--accent)' }, { label: 'Practice mode', value: best.practice, color: '#6ee7b7' }] as { label, value, color } (label)}
								<div>
									<div class="flex justify-between text-xs font-bold mb-1.5">
										<span class="uppercase tracking-wider text-white/45">{label}</span>
										<span class="tabular-nums" style="color: {color}">{pct(value)}</span>
									</div>
									<div class="h-3 rounded-full bg-white/8 overflow-hidden">
										<div
											class="h-full rounded-full transition-[width] duration-500"
											style="width: {Math.min(100, value)}%; background: {color}"
										></div>
									</div>
								</div>
							{/each}
							{#if best.attempts > 0}
								<p class="text-xs text-white/35">{best.attempts} attempts so far</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Playing it -->
				<footer
					class="relative flex flex-wrap items-center gap-x-5 gap-y-3 px-7 py-4 border-t border-white/10 bg-black/30"
				>
					<div class="flex items-center gap-1.5" role="radiogroup" aria-label="Your icon">
						{#each ICONS as icon, i (i)}
							<button
								class="rounded-lg ring-2 cursor-pointer transition {iconIndex === i
									? 'ring-white scale-110'
									: 'ring-transparent opacity-55 hover:opacity-100'}"
								style={iconLook(icon, 30)}
								role="radio"
								aria-checked={iconIndex === i}
								aria-label="Icon {i + 1}"
								onclick={() => (iconIndex = i)}
							></button>
						{/each}
					</div>

					<div class="flex items-center gap-2 ml-auto">
						<div class="flex p-1 rounded-full bg-white/8" role="radiogroup" aria-label="Mode">
							<button
								class="h-9 px-4 rounded-full text-sm font-bold cursor-pointer transition {!practice
									? 'bg-white text-black'
									: 'text-white/60 hover:text-white'}"
								role="radio"
								aria-checked={!practice}
								title="From the start every time: this is what counts"
								onclick={() => practice && onpractice()}>Normal</button
							>
							<button
								class="flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-bold cursor-pointer transition {practice
									? 'bg-emerald-400 text-emerald-950'
									: 'text-white/60 hover:text-white'}"
								role="radio"
								aria-checked={practice}
								title="With checkpoints: {keyName(checkpointKeys.place)} sets one, {keyName(
									checkpointKeys.remove
								)} removes the last (P while playing)"
								onclick={() => !practice && onpractice()}
							>
								<span class="icon-[mingcute--flag-2-line] size-4"></span>
								Practice
							</button>
						</div>
						{#if practice}
							<button
								class="flex items-center gap-2 h-9 px-3 rounded-full text-xs font-bold cursor-pointer transition {autoCheckpoints
									? 'bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/40'
									: 'bg-white/8 text-white/55 hover:text-white'}"
								role="switch"
								aria-checked={autoCheckpoints}
								title="Checkpoints on their own every few seconds. Your own: {keyName(
									checkpointKeys.place
								)} sets one, {keyName(checkpointKeys.remove)} removes the last"
								onclick={() => (autoCheckpoints = !autoCheckpoints)}
								in:fly={{ x: -6, duration: 150 }}
							>
								<span
									class="size-2 rounded-full {autoCheckpoints ? 'bg-emerald-300' : 'bg-white/30'}"
								></span>
								Auto
							</button>
						{/if}
						<button
							class="flex items-center gap-2 h-12 px-5 rounded-full bg-white/10 font-semibold text-white/80 cursor-pointer hover:bg-white/15 hover:text-white transition disabled:opacity-40 disabled:cursor-default"
							title="Watch it played perfectly"
							disabled={screen !== 'ready' || !game}
							onclick={() => onplay(true)}
						>
							<span class="icon-[mingcute--eye-line] size-5"></span>
							Watch
						</button>
						<button
							class="play flex items-center justify-center gap-2 h-12 min-w-40 px-7 rounded-full text-lg font-black text-black cursor-pointer transition hover:scale-[1.04] active:scale-100 disabled:opacity-40 disabled:cursor-default disabled:hover:scale-100"
							style="background: var(--accent)"
							disabled={screen !== 'ready' || !game}
							onclick={() => onplay(false)}
						>
							<span class="icon-[mingcute--play-fill] size-6"></span>
							Play
							<kbd class="ml-1 px-1.5 py-0.5 rounded-md bg-black/15 text-[11px] font-bold font-sans"
								>Space</kbd
							>
						</button>
					</div>
				</footer>
				{#if level && screen === 'ready'}
					<p
						class="relative flex flex-wrap items-center gap-x-4 gap-y-1 px-7 py-2 text-xs text-white/40 bg-black/40"
					>
						<span class="flex items-center gap-1.5">
							<span class="size-1.5 rounded-full {exact ? 'bg-emerald-400' : 'bg-amber-400'}"
							></span>
							{#if exact}
								Synced to the sound itself{level.offset
									? ` (${level.offset > 0 ? '+' : ''}${level.offset} ms from the beatmap)`
									: ''}
							{:else}
								Synced by the beatmap's timing (this song's sound can't be read)
							{/if}
						</span>
						<span class="ml-auto">
							<kbd class="font-sans">↑</kbd> <kbd class="font-sans">↓</kbd> songs ·
							<kbd class="font-sans">Enter</kbd> play · <kbd class="font-sans">Esc</kbd> leave
						</span>
					</p>
				{/if}
			{/if}
		</section>
	</div>
</div>

<style>
	.play:not(:disabled) {
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.25) inset,
			0 8px 30px -6px var(--accent);
	}
</style>
