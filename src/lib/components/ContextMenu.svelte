<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';

	// Position of the context menu
	let x = 0;
	let y = 0;
	let showMenu = false;

	// Dispatch events for menu interactions
	const dispatch = createEventDispatcher();

	// Handler for right-click events
	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();

		// Position the menu at the cursor
		x = event.clientX;
		y = event.clientY;

		// Show the menu
		showMenu = true;

		// Dispatch the open event
		dispatch('open', { x, y });
	}

	// Close the menu when clicking elsewhere
	function handleClickOutside(event: MouseEvent) {
		if (showMenu) {
			showMenu = false;
			dispatch('close');
		}
	}

	// Handle escape key to close the menu
	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape' && showMenu) {
			showMenu = false;
			dispatch('close');
		}
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleKeyDown);
	});

	onDestroy(() => {
		document.removeEventListener('click', handleClickOutside);
		document.removeEventListener('keydown', handleKeyDown);
	});

	// Ensure the menu stays within viewport bounds
	$: adjustedX = x;
	$: adjustedY = y;

	function adjustMenuPosition(node: HTMLElement) {
		const rect = node.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// Adjust if menu would overflow right edge
		if (x + rect.width > viewportWidth) {
			adjustedX = viewportWidth - rect.width;
		}

		// Adjust if menu would overflow bottom edge
		if (y + rect.height > viewportHeight) {
			adjustedY = viewportHeight - rect.height;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context-menu-container inline-block" on:contextmenu={handleContextMenu}>
	<!-- Content that can be right-clicked -->
	<slot></slot>

	<!-- The context menu -->
	{#if showMenu}
		<div
			class="fixed z-50"
			style="left: {adjustedX}px; top: {adjustedY}px"
			transition:fly={{ y: 5, duration: 150 }}
			use:adjustMenuPosition
		>
			<div
				class="bg-white dark:bg-gray-800 shadow-lg rounded-md border dark:border-gray-700 py-1 min-w-48"
			>
				<slot name="menu">
					<!-- Default menu items if no custom menu is provided -->
					<div class="px-4 py-2 text-sm text-gray-400 dark:text-gray-500">
						No menu items provided
					</div>
				</slot>
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
