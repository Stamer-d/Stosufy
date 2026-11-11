<script>
	/**
	 * An arrow pointing the way the wind blows (degrees from north)
	 * @type {{ towards: number, size?: number, colour?: string, class?: string }}
	 */
	let { towards, size = 14, colour = 'currentColor', class: className = '' } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	class="shrink-0 transition-transform duration-700 {className}"
	style="transform: rotate({towards}deg)"
	aria-hidden="true"
>
	<path d="M12 2.5 L19.5 20.5 L12 16.2 L4.5 20.5 Z" fill={colour} stroke-linejoin="round" />
</svg>
