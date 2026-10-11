<script>
	import { fly } from 'svelte/transition';
	import {
		listen,
		startSession,
		joinSession,
		leaveSession,
		syncAgain
	} from '#lib/stores/listen.ts';
	import { user } from '#lib/stores/user.ts';
	import { showToast } from '#lib/stores/toast.ts';

	let open = $state(false);
	let root = $state(null);
	let codeInput = $state('');

	let live = $derived($listen.status === 'live');
	let host = $derived($listen.members.find((member) => member.isHost));
	let inviteLink = $derived($listen.code ? `stosufynew://listen/${$listen.code}` : '');

	async function copy(text, what) {
		await navigator.clipboard.writeText(text);
		showToast(`Copied the ${what}`, 'icon-[mingcute--copy-2-line]');
	}

	function join(event) {
		event.preventDefault();
		if (codeInput.trim()) joinSession(codeInput);
		codeInput = '';
	}
</script>

{#snippet avatar(member, size)}
	{#if member.avatarUrl}
		<img
			src={member.avatarUrl}
			alt=""
			class="{size} rounded-full object-cover ring-2 ring-[var(--color-app)]"
		/>
	{:else}
		<span
			class="{size} grid place-items-center rounded-full bg-primary-300 text-[10px] font-bold text-white ring-2 ring-[var(--color-app)]"
		>
			{member.username.slice(0, 1).toUpperCase()}
		</span>
	{/if}
{/snippet}

<svelte:window
	onclick={(e) => open && !root?.contains(e.target) && (open = false)}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
/>

<div class="relative mr-1" bind:this={root}>
	<button
		title={live ? `Listening together (${$listen.members.length})` : 'Listen together'}
		aria-label="Listen together"
		aria-expanded={open}
		class="h-8 min-w-8 px-1.5 flex items-center gap-1.5 rounded-full cursor-pointer transition {live
			? 'bg-primary-300/20 text-primary-500 hover:bg-primary-300/30'
			: 'text-secondary-600 hover:text-white hover:bg-secondary-300'}"
		onclick={() => (open = !open)}
	>
		{#if live}
			<span class="flex -space-x-1.5">
				{#each $listen.members.slice(0, 3) as member (member.osuId)}
					{@render avatar(member, 'size-5')}
				{/each}
			</span>
			<span class="text-xs font-bold tabular-nums">{$listen.members.length}</span>
		{:else}
			<span
				class="icon-[mingcute--group-line] size-[18px] {$listen.status === 'connecting'
					? 'animate-pulse'
					: ''}"
			></span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute top-full right-0 mt-2 w-80 p-4 rounded-xl bg-secondary-300 ring-1 ring-white/5 shadow-xl shadow-black/40 z-50"
			transition:fly={{ y: -6, duration: 150 }}
		>
			<h3 class="font-bold text-white">Listen together</h3>

			{#if live}
				<p class="mt-1 text-sm text-secondary-600">
					{#if $listen.isHost && $listen.activity}
						<span class="text-yellow-300">{$listen.activity}</span>
					{:else if $listen.isHost}
						Everyone hears what you play, at the same moment, mods included.
					{:else if !$listen.following}
						You're listening on your own.
					{:else if $listen.activity}
						{$listen.activity}
					{:else}
						Listening along with {host?.username ?? 'the host'}.
					{/if}
				</p>
				{#if !$listen.isHost && !$listen.following}
					<button
						class="mt-2 h-8 px-3 rounded-full bg-primary-300 hover:bg-primary-400 text-sm font-semibold text-white cursor-pointer transition"
						onclick={syncAgain}
					>
						Sync with {host?.username ?? 'the host'}
					</button>
				{/if}

				<div class="mt-4 flex items-center gap-2 p-2 pl-3 rounded-lg bg-black/20">
					<span class="flex-1 font-mono text-xl font-bold tracking-[0.2em] text-white">
						{$listen.code}
					</span>
					<button
						title="Copy the code"
						aria-label="Copy the code"
						class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer"
						onclick={() => copy($listen.code, 'code')}
					>
						<span class="icon-[mingcute--copy-2-line] size-4"></span>
					</button>
					<button
						title="Copy an invite link"
						aria-label="Copy an invite link"
						class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer"
						onclick={() => copy(inviteLink, 'invite link')}
					>
						<span class="icon-[mingcute--share-forward-line] size-4"></span>
					</button>
				</div>

				<h4 class="mt-4 mb-2 text-xs font-bold uppercase tracking-wider text-secondary-600">
					Listening now · {$listen.members.length}
				</h4>
				<ul class="flex flex-col gap-1 max-h-48 overflow-y-auto">
					{#each $listen.members as member (member.osuId)}
						<li class="flex items-center gap-2.5 h-9">
							{@render avatar(member, 'size-7')}
							<span class="flex-1 truncate text-sm font-semibold text-white">
								{member.username}{member.osuId === $user?.id ? ' (you)' : ''}
							</span>
							{#if member.isHost}
								<span
									class="px-2 rounded-full bg-primary-300/20 text-[11px] font-bold text-primary-500"
								>
									Host
								</span>
							{/if}
						</li>
					{/each}
				</ul>

				<button
					class="mt-4 w-full h-9 rounded-full ring-1 ring-white/10 text-sm font-semibold text-red-400 hover:bg-white/[0.06] cursor-pointer transition"
					onclick={() => {
						leaveSession();
						open = false;
					}}
				>
					{$listen.isHost && $listen.members.length > 1
						? 'Leave (someone else takes over)'
						: 'Leave'}
				</button>
			{:else}
				<p class="mt-1 text-sm text-secondary-600">
					Friends hear the same song as you at the same moment, mods included. Songs they don't have
					are downloaded for them.
				</p>
				{#if $listen.status === 'error'}
					<p class="mt-2 text-sm text-red-400">{$listen.message}</p>
				{/if}
				<button
					class="mt-4 w-full h-10 rounded-full bg-primary-300 hover:bg-primary-400 text-sm font-bold text-white cursor-pointer transition disabled:opacity-50"
					disabled={$listen.status === 'connecting'}
					onclick={startSession}
				>
					{$listen.status === 'connecting' ? 'Connecting…' : 'Start a session'}
				</button>
				<div class="my-4 flex items-center gap-3 text-xs text-secondary-600">
					<span class="flex-1 h-px bg-white/10"></span>
					or join one
					<span class="flex-1 h-px bg-white/10"></span>
				</div>
				<form class="flex gap-2" onsubmit={join}>
					<input
						bind:value={codeInput}
						placeholder="Code or invite link"
						aria-label="Code or invite link"
						class="flex-1 min-w-0 h-10 px-4 rounded-full bg-black/20 text-sm font-mono uppercase text-white placeholder:normal-case placeholder:font-sans placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20"
					/>
					<button
						type="submit"
						disabled={!codeInput.trim() || $listen.status === 'connecting'}
						class="h-10 px-4 rounded-full ring-1 ring-white/10 text-sm font-semibold text-white hover:bg-white/[0.06] cursor-pointer transition disabled:opacity-40"
					>
						Join
					</button>
				</form>
			{/if}
		</div>
	{/if}
</div>
