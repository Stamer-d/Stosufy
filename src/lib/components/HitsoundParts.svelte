<script>
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';

	/** Which parts of the hitsounds play: whistle, clap, finish, the slider ticks and slide, the spinner */
	const PARTS = [
		{ id: 'whistle', label: 'Whistle' },
		{ id: 'clap', label: 'Clap' },
		{ id: 'finish', label: 'Finish' },
		{ id: 'slidertick', label: 'Slider ticks' },
		{ id: 'sliderslide', label: 'Slider slide' },
		{ id: 'spinner', label: 'Spinner' }
	];

	let parts = $derived($userSettings.settings?.hitsoundParts ?? {});

	function toggle(id) {
		updateUserSettings({ hitsoundParts: { ...parts, [id]: parts[id] === false } });
	}
</script>

<div class="flex flex-wrap gap-1.5" role="group" aria-label="Hitsound parts">
	{#each PARTS as part (part.id)}
		{@const on = parts[part.id] !== false}
		<button
			aria-pressed={on}
			class="h-7 px-2.5 flex items-center gap-1 rounded-full text-xs font-semibold ring-1 cursor-pointer transition {on
				? 'ring-primary-500 bg-primary-500/15 text-white'
				: 'ring-white/10 text-secondary-600 hover:text-white'}"
			onclick={() => toggle(part.id)}
		>
			<span class="{on ? 'icon-[mingcute--check-line]' : 'icon-[mingcute--close-line]'} size-3.5"
			></span>
			{part.label}
		</button>
	{/each}
</div>
