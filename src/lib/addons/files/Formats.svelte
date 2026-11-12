<script>
	// Formats to click (the first few as buttons, the rest under "More"): what a file is to
	// become, for the converter and the editor.
	/**
	 * @type {{
	 *   targets: import('./formats.ts').Target[],
	 *   onpick: (id: string) => void,
	 *   label: string,
	 *   quick?: number,
	 *   disabled?: boolean
	 * }}
	 */
	let { targets, onpick, label, quick = 5, disabled = false } = $props();

	const soundOnly = (target) => target.group === 'Only the sound';
	const same = (target) => target.group === 'Same format';
	const titleOf = (target) =>
		soundOnly(target)
			? `Only the sound, as ${target.label}`
			: same(target)
				? `As ${target.label}, like it was`
				: `As ${target.label}`;
</script>

<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
	{#each targets.slice(0, quick) as target (target.id + target.group)}
		<button
			class="h-8 px-3 flex items-center gap-1.5 rounded-full text-sm font-bold cursor-pointer transition disabled:opacity-40 disabled:cursor-default {same(
				target
			)
				? 'bg-white text-black hover:bg-white/85'
				: 'bg-white/[0.08] hover:bg-white hover:text-black'}"
			title={titleOf(target)}
			data-target={target.id}
			{disabled}
			onclick={() => onpick(target.id)}
		>
			{#if soundOnly(target)}
				<span class="icon-[mingcute--music-2-line] size-3.5 opacity-70"></span>
			{/if}
			{target.label}
		</button>
	{/each}
	{#if targets.length > quick}
		<label
			class="relative h-8 pl-3 pr-2 flex items-center gap-1 rounded-full text-sm font-semibold text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition"
		>
			More
			<span class="icon-[mingcute--down-line] size-3.5"></span>
			<select
				class="absolute inset-0 opacity-0 cursor-pointer"
				aria-label="More formats"
				value=""
				{disabled}
				onchange={(event) => {
					const value = event.currentTarget.value;
					event.currentTarget.value = '';
					if (value) onpick(value);
				}}
			>
				<option value="" disabled>More formats</option>
				{#each targets.slice(quick) as target (target.id + target.group)}
					<option value={target.id} class="bg-panel">{titleOf(target).replace(/^As /, '')}</option>
				{/each}
			</select>
		</label>
	{/if}
</div>
