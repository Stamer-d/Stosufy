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
		md: 'p-2',
		lg: 'text-lg p-3 '
	};

	$: inputClasses = `
      ${sizeClasses[size]} 
      rounded ring-1 ring-secondary-300  transition  outline-none w-full bg-secondary-300
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:ring-secondary-400 focus:ring-secondary-600'}
    `;
</script>

<input
	on:blur
	on:change
	on:input
	{disabled}
	class={inputClasses}
	bind:value
	{placeholder}
	{type}
	{...$$restProps}
/>
