<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';

	/** `menu`: what the right-click shows */
	let {
		disabled = false,
		class: className = '',
		children,
		menu
	}: { disabled?: boolean; class?: string; children?: Snippet; menu?: Snippet } = $props();

	let x = $state(0);
	let y = $state(0);
	let showMenu = $state(false);
	// (moved in when it would go past the window's edge)
	let adjustedX = $state(0);
	let adjustedY = $state(0);

	const CLOSE_ALL_CONTEXT_MENUS = 'closeAllContextMenus';

	function handleContextMenu(event: MouseEvent) {
		if (disabled) {
			return;
		}
		event.preventDefault();

		window.dispatchEvent(new CustomEvent(CLOSE_ALL_CONTEXT_MENUS));

		x = adjustedX = event.clientX;
		y = adjustedY = event.clientY;

		showMenu = true;
	}

	function close() {
		showMenu = false;
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	onMount(() => {
		document.addEventListener('click', close);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener(CLOSE_ALL_CONTEXT_MENUS, close);
	});

	onDestroy(() => {
		document.removeEventListener('click', close);
		document.removeEventListener('keydown', handleKeyDown);
		window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS, close);
	});

	function adjustMenuPosition(node: HTMLElement) {
		const rect = node.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		if (x + rect.width > viewportWidth) {
			adjustedX = viewportWidth - rect.width;
		}

		if (y + rect.height > viewportHeight) {
			adjustedY = viewportHeight - rect.height;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context-menu-container block {className}" oncontextmenu={handleContextMenu}>
	{@render children?.()}

	{#if showMenu}
		<div
			class="fixed z-50"
			style="left: {adjustedX}px; top: {adjustedY}px"
			transition:fly={{ y: 5, duration: 150 }}
			use:adjustMenuPosition
		>
			<div
				class="bg-secondary-300 rounded-lg min-w-56 p-1.5 shadow-xl shadow-black/40 ring-1 ring-white/5"
			>
				{@render menu?.()}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Prevent text selection when right-clicking */
	.context-menu-container {
		user-select: none;
	}
</style>
