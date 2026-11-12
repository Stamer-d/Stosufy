<script>
	// For someone without songs yet: the ways to get some, on the home page (until there are
	// songs, or it's closed)
	import { closeFirstSteps, showFirstSteps } from '#lib/stores/firstSteps.ts';
	import { openSettings } from '#lib/stores/settings.ts';
	import { profileImportOpen } from '#lib/stores/osuProfile.ts';

	/** The search in the title bar, to find beatmaps */
	const search = () =>
		/** @type {HTMLInputElement | null} */ (document.querySelector('header input'))?.focus();

	const STEPS = [
		{
			icon: 'icon-[mingcute--folder-open-line]',
			title: 'Your osu! songs',
			text: 'Bring in the songs from your osu! folder',
			action: () => openSettings('library')
		},
		{
			icon: 'icon-[mingcute--user-star-line]',
			title: 'From your profile',
			text: 'Your favourites and top plays as playlists',
			action: () => profileImportOpen.set(true)
		},
		{
			icon: 'icon-[mingcute--search-line]',
			title: 'Find beatmaps',
			text: 'Search and download any song',
			action: search
		}
	];
</script>

{#if $showFirstSteps}
	<section
		class="relative w-full max-w-xl p-5 rounded-[1.6rem] bg-black/40 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl shadow-black/40"
		aria-labelledby="first-steps"
	>
		<button
			class="absolute top-3 right-3 size-8 grid place-items-center rounded-full text-white/55 hover:text-white hover:bg-white/10 cursor-pointer transition"
			aria-label="Close"
			title="Close"
			onclick={closeFirstSteps}
		>
			<span class="icon-[mingcute--close-line] size-4"></span>
		</button>
		<h2 id="first-steps" class="text-xl font-extrabold">Let's get your music in</h2>
		<p class="mt-1 text-sm text-white/65">Three ways to start, pick one:</p>
		<ul class="mt-4 grid gap-2 sm:grid-cols-3">
			{#each STEPS as step (step.title)}
				<li>
					<button
						class="w-full h-full flex flex-col items-start gap-2 p-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] text-start cursor-pointer transition outline-none focus-visible:ring-2 focus-visible:ring-white/70"
						onclick={step.action}
					>
						<span
							class="size-9 grid place-items-center rounded-xl bg-primary-500/20 text-primary-400"
						>
							<span class="{step.icon} size-5"></span>
						</span>
						<span class="font-bold leading-tight">{step.title}</span>
						<span class="text-xs text-white/65">{step.text}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
