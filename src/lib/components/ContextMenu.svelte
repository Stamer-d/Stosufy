<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';

	let x = 0;
	let y = 0;
	let showMenu = false;
	export let disabled = false;

	const dispatch = createEventDispatcher();

	const CLOSE_ALL_CONTEXT_MENUS = 'closeAllContextMenus';

	function handleContextMenu(event: MouseEvent) {
		if (disabled) {
			return;
		}
		event.preventDefault();

		window.dispatchEvent(new CustomEvent(CLOSE_ALL_CONTEXT_MENUS));

		x = event.clientX;
		y = event.clientY;

		showMenu = true;

		dispatch('open', { x, y });
	}

	function handleClickOutside(event: MouseEvent) {
		if (showMenu) {
			showMenu = false;
			dispatch('close');
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape' && showMenu) {
			showMenu = false;
			dispatch('close');
		}
	}

	function handleCloseAllContextMenus() {
		if (showMenu) {
			showMenu = false;
			dispatch('close');
		}
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener(CLOSE_ALL_CONTEXT_MENUS, handleCloseAllContextMenus);
	});

	onDestroy(() => {
		document.removeEventListener('click', handleClickOutside);
		document.removeEventListener('keydown', handleKeyDown);
		window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS, handleCloseAllContextMenus);
	});

	$: adjustedX = x;
	$: adjustedY = y;

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
<div class="context-menu-container inline-block" on:contextmenu={handleContextMenu}>
	<slot></slot>

	{#if showMenu}
		<div
			class="fixed z-50"
			style="left: {adjustedX}px; top: {adjustedY}px"
			transition:fly={{ y: 5, duration: 150 }}
			use:adjustMenuPosition
		>
			<div class="bg-secondary-300 shadow-lg rounded-md py-2 min-w-64 p-1.5">
				<slot name="menu"></slot>
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
