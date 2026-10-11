<script>
	import { downloadQueue, cancelDownloads, resumeDownloads } from '#lib/stores/downloadQueue.ts';

	let now = $state(Date.now());
	$effect(() => {
		if (!$downloadQueue.pausedUntil) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	let total = $derived($downloadQueue.done + $downloadQueue.failed + $downloadQueue.items.length);
	let current = $derived($downloadQueue.items[0]?.set);
	let wait = $derived(
		$downloadQueue.pausedUntil
			? Math.max(0, Math.ceil(($downloadQueue.pausedUntil - now) / 1000))
			: 0
	);
	let progress = $derived(total ? ($downloadQueue.done + $downloadQueue.failed) / total : 0);
</script>

{#if $downloadQueue.items.length}
	<div class="mx-2 mb-2 p-3 rounded-lg bg-white/[0.05] text-sm" aria-live="polite">
		<div class="flex items-center gap-2">
			<span
				class="size-4 shrink-0 {$downloadQueue.error
					? 'icon-[mingcute--warning-line] text-red-400'
					: wait
						? 'icon-[mingcute--time-line] text-yellow-400'
						: 'icon-[mingcute--download-2-line] text-primary-500'}"
			></span>
			<span class="font-semibold flex-1 truncate">
				{#if $downloadQueue.error}
					Downloads stopped
				{:else}
					Downloading {Math.min(total, $downloadQueue.done + $downloadQueue.failed + 1)} of {total}
				{/if}
			</span>
			{#if $downloadQueue.error}
				<button
					class="text-xs text-secondary-600 hover:text-white cursor-pointer"
					onclick={resumeDownloads}>Retry</button
				>
			{/if}
			<button
				title="Cancel downloads"
				aria-label="Cancel downloads"
				class="size-6 grid place-items-center rounded-full text-secondary-600 hover:text-white cursor-pointer"
				onclick={cancelDownloads}
			>
				<span class="icon-[mingcute--close-line] size-4"></span>
			</button>
		</div>
		<p class="mt-1 text-xs text-secondary-600 truncate">
			{#if $downloadQueue.error}
				<span class="text-red-400" title={$downloadQueue.error}>{$downloadQueue.error}</span>
			{:else if wait}
				osu! asks to slow down, going on in {wait} s
			{:else if current}
				{current.title} · {current.artist}
			{/if}
		</p>
		<div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
			<div
				class="h-full rounded-full bg-primary-500 transition-[width] duration-500"
				style="width: {progress * 100}%"
			></div>
		</div>
		{#if $downloadQueue.failed}
			<p class="mt-1 text-xs text-secondary-600">{$downloadQueue.failed} failed</p>
		{/if}
	</div>
{/if}
