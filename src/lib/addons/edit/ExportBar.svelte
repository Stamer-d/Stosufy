<script>
	// Where an edit is saved: its format and size limit chosen, then Export (a new file in
	// Stosufy/Edited) or Replace original (its file itself, the old one to the trash: asked
	// first). While it's saved: how far, and Stop.
	import Dropdown from '../files/Dropdown.svelte';
	import { LIMITS, sizeLimit } from './limit.ts';

	/**
	 * @type {{
	 *   targets: import('../files/formats.ts').Target[],
	 *   busy: boolean,
	 *   progress?: number,
	 *   onexport: (targetId: string) => void,
	 *   onstop?: () => void,
	 *   original?: string | null,
	 *   onreplace?: () => void,
	 *   children?: import('svelte').Snippet
	 * }}
	 */
	let {
		targets,
		busy,
		progress = 0,
		onexport,
		onstop,
		original = null,
		onreplace,
		children
	} = $props();

	const hintOf = (target) =>
		target.group === 'Same format'
			? 'the format it is'
			: target.group === 'Only the sound'
				? 'only the sound'
				: '';
	/** Each format once, its own first */
	let formats = $derived(
		targets
			.filter((target, i) => targets.findIndex((other) => other.id === target.id) === i)
			.map((target) => ({ value: target.id, label: target.label, hint: hintOf(target) }))
	);
	let chosen = $state(/** @type {string | null} */ (null));
	let format = $derived(formats.find((option) => option.value === chosen) ?? formats[0]);
	/** Replacing: asked first */
	let asking = $state(false);
</script>

<section
	class="flex flex-col gap-2 p-3 rounded-2xl bg-violet-300/[0.07] ring-1 ring-violet-300/20"
	aria-label="Export"
>
	{#if busy}
		<div class="h-11 flex items-center gap-3">
			<span class="pl-1 text-sm font-semibold">Saving…</span>
			<div
				class="flex-1 min-w-40 h-1.5 rounded-full bg-white/10 overflow-hidden"
				role="progressbar"
				aria-label="Saving"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={progress > 0 ? Math.round(progress * 100) : undefined}
			>
				{#if progress > 0}
					<div
						class="h-full rounded-full bg-violet-300 transition-[width]"
						style="width: {progress * 100}%"
					></div>
				{:else}
					<div class="h-full w-full rounded-full bg-violet-300/50 animate-pulse"></div>
				{/if}
			</div>
			{#if onstop}
				<button
					class="h-9 px-4 rounded-full text-sm font-semibold text-white/70 hover:text-white hover:bg-white/10 cursor-pointer transition"
					onclick={onstop}
				>
					Stop
				</button>
			{/if}
		</div>
	{:else if asking}
		<div class="min-h-11 flex flex-wrap items-center gap-3" role="alertdialog" aria-label="Replace">
			<span class="icon-[mingcute--warning-line] size-5 shrink-0 text-amber-200"></span>
			<p class="flex-1 min-w-48 text-sm">
				Replace <b class="font-semibold">{original}</b> with the edited one? The original goes to the
				trash.
			</p>
			<button
				class="h-9 px-4 rounded-full text-sm font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
				onclick={() => (asking = false)}
			>
				Cancel
			</button>
			<button
				class="h-9 px-4 rounded-full text-sm font-bold bg-amber-300 text-black hover:bg-amber-200 cursor-pointer transition"
				onclick={() => {
					asking = false;
					onreplace?.();
				}}
			>
				Replace it
			</button>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<Dropdown
				label="Format"
				prefix="Format"
				icon="icon-[mingcute--file-line]"
				options={formats}
				value={format?.value}
				onchange={(value) => (chosen = value)}
			/>
			<Dropdown
				label="Size limit"
				icon="icon-[mingcute--arrow-down-line]"
				options={LIMITS}
				value={$sizeLimit}
				onchange={(value) => sizeLimit.set(value)}
			/>
			{@render children?.()}
			<div class="ml-auto flex flex-wrap items-center gap-2">
				{#if original && onreplace}
					<button
						class="h-11 px-4 flex items-center gap-2 rounded-full text-sm font-semibold bg-white/[0.08] hover:bg-white/15 cursor-pointer transition"
						title="Save it over {original} (in its own format)"
						onclick={() => (asking = true)}
					>
						<span class="icon-[mingcute--refresh-2-line] size-4"></span>
						Replace original
					</button>
				{/if}
				<button
					class="h-11 px-6 flex items-center gap-2 rounded-full text-base font-bold bg-violet-600 hover:bg-violet-500 text-white cursor-pointer transition"
					title="A new file in Stosufy/Edited"
					onclick={() => format && onexport(format.value)}
				>
					<span class="icon-[mingcute--download-2-line] size-5"></span>
					Export{format ? ` as ${format.label}` : ''}
				</button>
			</div>
		</div>
	{/if}
</section>
