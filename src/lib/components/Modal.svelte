<script>
	// @ts-nocheck

	import { onMount, createEventDispatcher } from 'svelte';
	import Button from './Button.svelte';
	// Props
	export let open = false;
	export let title = '';
	export let closeOnEsc = true;
	export let closeOnOutsideClick = true;
	export let width = '600px';

	let modal;
	let previouslyFocused;

	function close() {
		open = false;
	}

	function handleKeydown(e) {
		if (closeOnEsc && e.key === 'Escape' && open) {
			close();
		}
	}

	function handleOutsideClick(e) {
		if (closeOnOutsideClick && modal && !modal.contains(e.target) && open) {
			close();
		}
	}

	$: if (open) {
		// When modal opens, track previously focused element
		previouslyFocused = document.activeElement;

		// Add event listeners
		setTimeout(() => {
			document.addEventListener('keydown', handleKeydown);
			document.addEventListener('mousedown', handleOutsideClick);

			// Focus the first focusable element
			const focusable = modal.querySelectorAll(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length > 0) {
				focusable[0].focus();
			}
		}, 0);
	} else {
		// Remove event listeners when modal closes
		document.removeEventListener('keydown', handleKeydown);
		document.removeEventListener('mousedown', handleOutsideClick);

		// Return focus to previously focused element
		if (previouslyFocused) {
			previouslyFocused.focus();
		}
	}

	onMount(() => {
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('mousedown', handleOutsideClick);
		};
	});
</script>

{#if open}
	<div
		class="modal-backdrop fixed inset-0 bg-secondary-100/70 z-40 flex items-center justify-center px-4"
		role="presentation"
	>
		<div
			class="modal bg-secondary-200 rounded-lg max-w-md z-50"
			style="width: {width};"
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			bind:this={modal}
		>
			<div class="modal-content">
				{#if title}
					<div class="modal-header border-b border-secondary-200 p-3">
						<h2 id="modal-title" class="text-lg font-medium">{title}</h2>
					</div>
				{/if}

				<div class="modal-body p-3">
					<slot />
				</div>

				<div class="modal-footer p-4 flex justify-end">
					<slot name="footer">
						<Button
							on:click={() => {
								close();
							}}
						>
							Close
						</Button>
					</slot>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Add any custom styles here if needed */
	.modal-backdrop {
		animation: fadeIn 0.15s ease;
	}

	.modal {
		animation: slideIn 0.2s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideIn {
		from {
			transform: translateY(-20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
