<script lang="ts">
	export let type: 'ghost' | 'normal' | 'primary' = 'normal';
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let disabled = false;
	export let icon: string | null = null;
	export let iconLeft = icon;
	export let iconRight: string | null = null;

	const typeClasses = {
		normal: 'bg-secondary-300/40 text-white',
		ghost: 'text-gray-400',
		primary: 'bg-primary-200 text-white'
	};

	const hoverClasses = {
		normal: 'hover:bg-secondary-300/60 active:bg-secondary-300',
		ghost: 'hover:text-gray-200 active:text-white',
		primary: 'hover:bg-primary-300 active:bg-primary-400'
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
      rounded-lg font-medium transition flex gap-2
      ${disabled ? 'cursor-not-allowed' : 'cursor-pointer '}
    `;
</script>

<button class={buttonClasses} on:click {disabled} on:mouseover on:focus on:blur>
	{#if iconLeft?.includes('icon-')}
		<span class="flex-none inline-grid" aria-hidden="true">
			<span class="place-self-center opacity-75 {iconLeft}" />
		</span>
	{/if}
	{#if $$slots.default}
		<slot></slot>
	{/if}
	{#if iconRight?.includes('icon-')}
		<span class="flex-none inline-grid" aria-hidden="true">
			<span class="place-self-center opacity-75 {iconRight}" />
		</span>
	{/if}
</button>
