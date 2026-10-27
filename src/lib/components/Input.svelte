<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'size'> {
		size?: 'sm' | 'md' | 'lg';
		value?: string;
	}

	let {
		type = 'text',
		size = 'md',
		disabled = false,
		placeholder = '',
		value = $bindable(''),
		class: className = '',
		...rest
	}: Props = $props();

	const sizeClasses = {
		sm: 'text-xs p-1',
		md: 'h-10 px-3 text-sm',
		lg: 'text-lg p-3 '
	};

	let inputClasses = $derived(`
      ${sizeClasses[size]}
      w-full rounded-lg bg-secondary-300 outline-none ring-1 ring-transparent transition
      placeholder:text-secondary-600
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-secondary-400 focus:bg-secondary-300 focus:ring-primary-400'}
    `);
</script>

<input
	{...rest}
	{disabled}
	class="{inputClasses} {className ?? ''}"
	bind:value
	{placeholder}
	{type}
/>
