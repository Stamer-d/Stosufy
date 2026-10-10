<script lang="ts">
	export let type: 'ghost' | 'normal' | 'primary' = 'normal';
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let disabled = false;
	export let icon: string | null = null;
	export let iconLeft: string | null = null;
	export let iconRight: string | null = null;

	$: leftIcon = iconLeft ?? icon;

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
	$: buttonClasses = `
	  ${$$restProps?.class ?? ''}
	  ${!disabled ? hoverClasses[type] : 'text-secondary-500'}
      ${typeClasses[type]} 
      ${sizeClasses[size]} 
      rounded-lg font-semibold transition flex items-center gap-2
      ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
    `;
</script>

<button {...$$restProps} class={buttonClasses} on:click {disabled} on:mouseover on:focus on:blur>
	{#if leftIcon?.includes('icon-')}
		<span class="flex-none inline-grid" aria-hidden="true">
			<span class="place-self-center opacity-75 {leftIcon}"></span>
		</span>
	{/if}
	{#if $$slots.default}
		<slot></slot>
	{/if}
	{#if iconRight?.includes('icon-')}
		<span class="flex-none inline-grid" aria-hidden="true">
			<span class="place-self-center opacity-75 {iconRight}"></span>
		</span>
	{/if}
</button>
