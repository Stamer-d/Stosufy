<script>
	// All about something a tracker put on the map: what its tracker says about it (loaded
	// when it's picked), with its picture (renewed while it's open), video or timelapse, the
	// numbers, a list (like the next departures) and links.
	import { open as openUrl } from '@tauri-apps/plugin-shell';

	/**
	 * @type {{
	 *   feature: import('#lib/world/types.ts').Feature,
	 *   source: import('#lib/world/types.ts').LayerSource,
	 *   onclose: () => void
	 * }}
	 */
	let { feature, source, onclose } = $props();

	/** @type {import('#lib/world/types.ts').Details | null} */
	let details = $state(null);
	let error = $state('');
	let loadedFor = '';
	$effect(() => {
		const f = feature;
		const key = `${source.id}/${f.id}`;
		if (key === loadedFor) return;
		loadedFor = key;
		details = null;
		error = '';
		const controller = new AbortController();
		Promise.resolve(source.details(f, controller.signal))
			.then((result) => {
				if (loadedFor === key) details = result;
			})
			.catch((e) => {
				if (loadedFor === key && !controller.signal.aborted)
					error = e?.message ?? 'Could not load the details';
			});
		return () => controller.abort();
	});

	// The picture, renewed while it's shown
	let view = $state('picture');
	let stamp = $state(Date.now());
	let broken = $state(false);
	$effect(() => {
		void details;
		view = 'picture';
		broken = false;
	});
	$effect(() => {
		const every = details?.image?.every;
		if (!every) return;
		const timer = setInterval(() => (stamp = Date.now()), every);
		return () => clearInterval(timer);
	});
	let imageUrl = $derived(
		details?.image?.url && details.image.every
			? `${details.image.url}${details.image.url.includes('?') ? '&' : '?'}t=${Math.floor(stamp / 1000)}`
			: details?.image?.url
	);
	let views = $derived(
		details?.image
			? [
					['picture', 'Picture'],
					...(details.image.video ? [['video', 'Video']] : []),
					...(details.image.embed ? [['embed', 'Timelapse']] : [])
				]
			: []
	);
</script>

<header class="p-4 pb-3 border-b border-white/[0.06]">
	<div class="flex items-start gap-3">
		{#if details?.badge}
			<span
				class="flex flex-col items-center justify-center min-w-14 h-14 px-1.5 shrink-0 rounded-2xl text-black"
				style="background: {details.badge.colour}"
			>
				<span class="text-lg font-extrabold leading-none tabular-nums">{details.badge.text}</span>
				{#if details.badge.small}<span class="text-[10px] font-bold">{details.badge.small}</span
					>{/if}
			</span>
		{:else}
			<span
				class="grid place-items-center size-11 shrink-0 rounded-xl"
				style="background: {feature.colour}22; color: {feature.colour}"
			>
				<span class="{source.icon} size-6"></span>
			</span>
		{/if}
		<div class="min-w-0 flex-1">
			<p class="font-bold leading-tight">{details?.title ?? feature.label ?? source.label}</p>
			<p class="mt-0.5 text-sm text-white/60">
				{#if details}{details.subtitle ?? source.label}{:else if error}<span class="text-rose-300"
						>{error}</span
					>{:else}Loading…{/if}
			</p>
		</div>
		<button
			class="grid place-items-center size-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Close"
			onclick={onclose}><span class="icon-[mingcute--close-line] size-4"></span></button
		>
	</div>
</header>
<div class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
	{#if details}
		{#if details.image}
			<div class="flex flex-col gap-1.5">
				{#if views.length > 1}
					<div class="flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold self-start">
						{#each views as [value, label] (value)}
							<button
								class="px-2.5 h-6 rounded-md cursor-pointer {view === value
									? 'bg-white/15'
									: 'text-white/55 hover:text-white'}"
								onclick={() => (view = value)}>{label}</button
							>
						{/each}
					</div>
				{/if}
				<div class="relative rounded-xl overflow-hidden bg-black/40 ring-1 ring-white/10">
					{#if view === 'video' && details.image.video}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={details.image.video} class="w-full" autoplay muted loop controls playsinline
						></video>
					{:else if view === 'embed' && details.image.embed}
						<iframe
							src={details.image.embed}
							title={details.title}
							class="w-full aspect-video"
							allow="autoplay; fullscreen"
						></iframe>
					{:else if broken}
						<p class="grid place-items-center aspect-video text-xs text-white/45">
							The picture can't be shown right now
						</p>
					{:else}
						<img
							src={imageUrl}
							alt={details.title}
							class="w-full"
							onerror={() => (broken = true)}
							onload={() => (broken = false)}
						/>
						{#if details.image.every}
							<span
								class="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-semibold"
								><span class="size-1.5 rounded-full bg-red-500 animate-pulse"></span>Live</span
							>
						{/if}
					{/if}
				</div>
				{#if details.image.caption}
					<p class="text-[11px] text-white/45">{details.image.caption}</p>
				{/if}
			</div>
		{/if}
		{#if details.text}
			<p class="text-sm text-white/75 whitespace-pre-line">{details.text}</p>
		{/if}
		{#if details.stats?.length}
			<div class="grid grid-cols-2 gap-2">
				{#each details.stats as stat (stat.label)}
					<div class="p-2.5 rounded-xl bg-white/[0.04] min-w-0">
						<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">{stat.label}</p>
						<p class="text-sm font-bold tabular-nums leading-snug break-words">{stat.value}</p>
						{#if stat.hint}<p class="text-[11px] text-white/45 truncate">{stat.hint}</p>{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if details.rowsTitle || details.rows?.length}
			<div>
				{#if details.rowsTitle}
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
						{details.rowsTitle}
					</p>
				{/if}
				<div class="flex flex-col">
					{#each details.rows ?? [] as row, i (i)}
						<div
							class="flex items-center gap-2.5 py-1.5 border-b border-white/[0.05] last:border-0"
						>
							{#if row.colour}
								<span class="w-1 self-stretch rounded-full" style="background: {row.colour}"></span>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="text-sm font-semibold truncate">{row.title}</p>
								{#if row.sub}<p class="text-[11px] text-white/50 truncate">{row.sub}</p>{/if}
							</div>
							{#if row.badge}
								<span class="px-1.5 rounded-md bg-rose-500/20 text-rose-300 text-[11px] font-bold"
									>{row.badge}</span
								>
							{/if}
							{#if row.value}
								<span class="text-sm font-bold tabular-nums">{row.value}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
		{#if details.actions?.length}
			<div class="flex flex-col gap-2">
				{#each details.actions as action (action.label)}
					<button
						class="flex items-center justify-center gap-2 h-10 rounded-xl bg-sky-400/15 text-sky-200 hover:bg-sky-400/25 text-sm font-semibold cursor-pointer"
						onclick={action.run}><span class="{action.icon} size-4"></span>{action.label}</button
					>
				{/each}
			</div>
		{/if}
		{#if details.links?.length}
			<div class="flex flex-col gap-2">
				{#each details.links as link (link.url)}
					<button
						class="flex items-center justify-center gap-2 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold cursor-pointer"
						onclick={() => openUrl(link.url)}
						><span class="icon-[mingcute--external-link-line] size-4"></span>{link.label}</button
					>
				{/each}
			</div>
		{/if}
	{:else if !error}
		<p class="text-sm text-white/50">Loading…</p>
	{/if}
</div>
<footer class="px-4 py-2.5 border-t border-white/[0.06] text-[11px] text-white/40">
	{details?.source ?? source.attribution}
</footer>
