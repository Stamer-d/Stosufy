<script>
	// The add-ons' choices (a format, a quality, Fade in, …): the app's own Select, with what
	// they need named their way. `prefix`: its name shown before what's chosen ("Fade in: Off");
	// without one, only what's chosen (with `icon`) is shown.
	import Select from '#lib/components/Select.svelte';

	/**
	 * @type {{
	 *   options: { value: any, label: string, hint?: string, side?: string }[],
	 *   value: any,
	 *   onchange: (value: any) => void,
	 *   label: string,
	 *   icon?: string,
	 *   prefix?: string,
	 *   disabled?: boolean,
	 *   sideOnButton?: boolean
	 * }}
	 */
	let {
		options,
		value,
		onchange,
		label,
		icon = '',
		prefix = '',
		disabled = false,
		sideOnButton = true
	} = $props();
</script>

<Select
	{options}
	{value}
	{onchange}
	label={prefix || label}
	{icon}
	hideLabel={!prefix}
	{disabled}
	{sideOnButton}
/>
