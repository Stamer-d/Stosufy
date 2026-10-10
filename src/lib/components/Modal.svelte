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
		class="modal-backdrop fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 overflow-y-auto"
		role="presentation"
	>
		<div
			class="modal bg-secondary-200 rounded-xl my-auto z-50 max-h-[90vh] flex flex-col shadow-2xl shadow-black/60 ring-1 ring-white/5"
			style="width: {width}; max-width: 95vw;"
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			bind:this={modal}
		>
			<div class="modal-content flex flex-col max-h-[80vh]">
				{#if title}
					<div class="modal-header px-5 pt-5 pb-2 flex-shrink-0">
						<h2 id="modal-title" class="text-xl font-bold">{title}</h2>
					</div>
				{/if}

				<div class="modal-body px-5 py-2 overflow-y-auto text-sm text-white/80">
					<slot />
				</div>

				<div class="modal-footer px-5 pb-5 pt-4 flex justify-end gap-2 flex-shrink-0">
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
