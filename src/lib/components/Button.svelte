<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLButtonAttributes, 'type'> {
		type?: 'ghost' | 'normal' | 'primary';
		size?: 'sm' | 'md' | 'lg';
		icon?: string | null;
		iconLeft?: string | null;
		iconRight?: string | null;
		children?: Snippet;
	}

	let {
		type = 'normal',
		size = 'md',
		disabled = false,
		icon = null,
		iconLeft = null,
		iconRight = null,
		class: className = '',
		children,
		...rest
	}: Props = $props();

	let leftIcon = $derived(iconLeft ?? icon);

	const typeClasses = {
		normal: 'bg-secondary-300 text-white',
		ghost: 'text-gray-300',
		primary: 'bg-primary-300 text-white'
	};

	const hoverClasses = {
		normal: 'hover:bg-secondary-400 active:bg-secondary-500',
		ghost: 'hover:text-white active:text-white',
		primary: 'hover:bg-primary-400 active:bg-primary-200'
	};

	const sizeClasses = {
		sm: 'text-sm p-1.5',
		md: 'p-2',
		lg: 'text-lg p-3 '
	};
	let buttonClasses = $derived(`
	  ${className ?? ''}
	  ${!disabled ? hoverClasses[type] : 'text-secondary-500'}
      ${typeClasses[type]} 
      ${sizeClasses[size]} 
      rounded-lg font-semibold transition flex items-center gap-2
      ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
    `);
</script>

<button {...rest} class={buttonClasses} {disabled}>
	{#if leftIcon?.includes('icon-')}
		<span class="flex-none inline-grid" aria-hidden="true">
			<span class="place-self-center opacity-75 {leftIcon}"></span>
		</span>
	{/if}
	{@render children?.()}
	{#if iconRight?.includes('icon-')}
		<span class="flex-none inline-grid" aria-hidden="true">
			<span class="place-self-center opacity-75 {iconRight}"></span>
		</span>
	{/if}
</button>
