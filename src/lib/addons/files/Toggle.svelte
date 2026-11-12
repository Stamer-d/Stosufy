<script>
	// A button of the add-ons' toolbars: something to do (Turn, Save frame) or, with `pressed`,
	// something on or off (Mirror, No sound). As high as a dropdown, to sit in a row with them.
	/**
	 * @type {{
	 *   label: string,
	 *   icon?: string,
	 *   pressed?: boolean,
	 *   title?: string,
	 *   disabled?: boolean,
	 *   onclick: () => void
	 * }}
	 */
	let { label, icon = '', pressed, title, disabled = false, onclick } = $props();
</script>

<button
	class="h-10 px-3 flex items-center gap-2 rounded-xl text-sm font-semibold whitespace-nowrap cursor-pointer transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:cursor-default {pressed
		? 'bg-white text-black'
		: 'bg-white/[0.07] enabled:hover:bg-white/[0.12]'}"
	aria-pressed={pressed}
	{title}
	{disabled}
	{onclick}
>
	{#if icon}
		<span class="{icon} size-4 shrink-0 {pressed ? '' : 'text-white/60'}"></span>
	{/if}
	{label}
</button>
