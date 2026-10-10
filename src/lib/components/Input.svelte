<script lang="ts">
	export let type:
		| 'text'
		| 'number'
		| 'email'
		| 'tel'
		| 'date'
		| 'datetime-local'
		| 'url'
		| 'search'
		| 'password' = 'text';
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let disabled = false;
	export let placeholder = '';
	export let value = '';

	const sizeClasses = {
		sm: 'text-xs p-1',
		md: 'h-10 px-3 text-sm',
		lg: 'text-lg p-3 '
	};

	$: inputClasses = `
      ${sizeClasses[size]}
      w-full rounded-lg bg-secondary-300 outline-none ring-1 ring-transparent transition
      placeholder:text-secondary-600
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-secondary-400 focus:bg-secondary-300 focus:ring-primary-400'}
    `;
</script>

<input
	on:blur
	on:change
	on:input
	{...$$restProps}
	{disabled}
	class="{inputClasses} {$$restProps.class ?? ''}"
	bind:value
	{placeholder}
	{type}
/>
