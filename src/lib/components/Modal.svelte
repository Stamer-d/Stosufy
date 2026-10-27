<script>
	import Button from './Button.svelte';

	/**
	 * A dialog over the app. `footer` replaces its Close button.
	 * @type {{
	 *   open?: boolean,
	 *   title?: string,
	 *   closeOnEsc?: boolean,
	 *   closeOnOutsideClick?: boolean,
	 *   width?: string,
	 *   children?: import('svelte').Snippet,
	 *   footer?: import('svelte').Snippet
	 * }}
	 */
	let {
		open = $bindable(false),
		title = '',
		closeOnEsc = true,
		closeOnOutsideClick = true,
		width = '600px',
		children,
		footer
	} = $props();

	let modal = $state();

	function close() {
		open = false;
	}

	function handleKeydown(e) {
		if (closeOnEsc && e.key === 'Escape') close();
	}

	function handleOutsideClick(e) {
		if (closeOnOutsideClick && modal && !modal.contains(e.target)) close();
	}

	// While it's open: Escape and a click outside close it, the focus is in it (and goes back
	// to where it was once it closes)
	$effect(() => {
		if (!open) return;
		const previouslyFocused = document.activeElement;
		const timer = setTimeout(() => {
			document.addEventListener('keydown', handleKeydown);
			document.addEventListener('mousedown', handleOutsideClick);
			modal
				?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
				?.focus();
		}, 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('mousedown', handleOutsideClick);
			if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
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
					{@render children?.()}
				</div>

				<div class="modal-footer px-5 pb-5 pt-4 flex justify-end gap-2 flex-shrink-0">
					{#if footer}
						{@render footer()}
					{:else}
						<Button onclick={close}>Close</Button>
					{/if}
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
