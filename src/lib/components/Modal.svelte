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
		previouslyFocused = document.activeElement;
		setTimeout(() => {
			document.addEventListener('keydown', handleKeydown);
			document.addEventListener('mousedown', handleOutsideClick);
			const focusable = modal.querySelectorAll(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length > 0) {
				focusable[0].focus();
			}
		}, 0);
	} else {
		document.removeEventListener('keydown', handleKeydown);
		document.removeEventListener('mousedown', handleOutsideClick);
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
		class="modal-backdrop fixed inset-0 bg-secondary-100/70 z-40 flex items-center justify-center p-4 overflow-y-auto"
		role="presentation"
	>
		<div
			class="modal bg-secondary-200 rounded-lg my-auto z-50 max-h-[90vh] flex flex-col"
			style="width: {width}; max-width: 95vw;"
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			bind:this={modal}
		>
			<div class="modal-content flex flex-col max-h-[80vh]">
				{#if title}
					<div class="modal-header border-b border-secondary-200 p-3 flex-shrink-0">
						<h2 id="modal-title" class="text-lg font-medium">{title}</h2>
					</div>
				{/if}

				<div class="modal-body p-3 overflow-y-auto">
					<slot />
				</div>

				<div class="modal-footer p-4 flex justify-end gap-2 flex-shrink-0">
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
