<script>
	// The header of a playlist, a mix or the downloads, as in the desktop app: its color from
	// the cover washing down, osu!'s triangles rising, the cover, what it is, its name. Once
	// scrolled away, a bar with the name and Play stays at the top.
	import { goBack } from './navigation';
	import Triangles from '../lib/components/Triangles.svelte';

	/** @type {{ color?: string | null, seed?: number, label?: string, title: string, back?: string, onplay?: () => void, cover: import('svelte').Snippet, children?: import('svelte').Snippet, actions?: import('svelte').Snippet }} */
	let {
		color = null,
		seed = 7,
		label = '',
		title,
		back = '',
		onplay,
		cover,
		children,
		actions
	} = $props();

	/** Back to the page before (as a phone app does), else up to `back` */
	function back_(event) {
		event.preventDefault();
		goBack(back === 'history' ? undefined : back);
	}

	let gone = $state(false);
	function watch(node) {
		const observer = new IntersectionObserver(([entry]) => (gone = !entry.isIntersecting), {
			rootMargin: '-56px 0px 0px 0px'
		});
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}
</script>

<div
	class="sticky top-0 z-[25] -mt-[env(safe-area-inset-top)] -mb-[calc(3.5rem+env(safe-area-inset-top))] h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-1 flex items-center gap-1 transition-[background-color,opacity] duration-200 {gone
		? 'opacity-100'
		: 'opacity-0 pointer-events-none'}"
	style="background-color: color-mix(in oklab, {color ??
		'var(--color-panel)'} 55%, var(--color-panel));"
>
	{#if back}
		<a
			href={back === 'history' ? `${__WEB_BASE__}/` : back}
			onclick={back_}
			aria-label="Back"
			class="size-12 grid place-items-center"
		>
			<span class="icon-[mingcute--left-line] size-7"></span>
		</a>
	{/if}
	<p class="min-w-0 flex-1 text-lg font-bold truncate">{title}</p>
	{#if onplay}
		<button
			aria-label="Play"
			class="mr-1.5 size-10 grid place-items-center rounded-full bg-primary-300 shadow-md"
			onclick={onplay}
		>
			<span class="icon-[mingcute--play-fill] size-6"></span>
		</button>
	{/if}
</div>

<!-- (its color reaches up behind the clock) -->
<div
	class="-mt-[env(safe-area-inset-top)] pt-[env(safe-area-inset-top)] transition-colors duration-500"
	style="background: linear-gradient(to bottom, {color ?? 'transparent'} 0, transparent 26rem)"
>
	<header class="relative px-4 pt-2 pb-4 overflow-hidden" use:watch>
		<Triangles count={12} {seed} />
		{#if back}
			<a
				href={back === 'history' ? `${__WEB_BASE__}/` : back}
				onclick={back_}
				aria-label="Back"
				class="relative -ml-3 size-12 grid place-items-center"
			>
				<span class="icon-[mingcute--left-line] size-7"></span>
			</a>
		{/if}
		<div class="relative mt-2 flex justify-center">
			{@render cover()}
		</div>
		<div class="relative mt-5">
			{#if label}<p class="text-sm font-semibold">{label}</p>{/if}
			<h1
				class="mt-0.5 text-3xl font-extrabold tracking-tight leading-[1.05] line-clamp-2 break-words"
			>
				{title}
			</h1>
			{@render children?.()}
		</div>
	</header>
	{#if actions}
		<div class="flex items-center gap-3 px-4 py-3 bg-black/10">
			{@render actions()}
		</div>
	{/if}
</div>
