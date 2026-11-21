<script lang="ts">
	// Settings → Claude: turn the connection on, add Stosufy to Claude (Desktop with a click,
	// Claude Code with a command), and what to ask then
	import { onMount } from 'svelte';
	import { open as openUrl } from '@tauri-apps/plugin-shell';
	import Button from './Button.svelte';
	import { showToast } from '#lib/stores/toast.ts';
	import {
		claudeActivity,
		claudeStatus,
		claudeCodeCommand,
		connectDesktop,
		desktopConfig,
		desktopStatus,
		disconnectDesktop,
		setClaudeChanges,
		setClaudeEnabled,
		type ClaudeStatus,
		type DesktopStatus
	} from '#lib/mcp/connection.ts';

	let status = $state<ClaudeStatus | null>(null);
	let desktop = $state<DesktopStatus | null>(null);
	let client = $state<'desktop' | 'code'>('desktop');
	let busy = $state(false);
	let problem = $state('');
	let clock = $state(Date.now());

	const EXAMPLES = [
		'Make me a playlist from what I listened to this month',
		'Make a playlist of fast anime openings around 180 BPM',
		'What did I listen to the most this week?',
		'Find osu! songs like my favourites that I don’t have yet',
		'Play something calm from my downloaded songs'
	];

	async function refresh() {
		try {
			[status, desktop] = await Promise.all([claudeStatus(), desktopStatus()]);
		} catch (error) {
			problem = String(error);
		}
	}

	onMount(() => {
		refresh();
		// (Claude may have been set up by hand meanwhile, and "2 min ago" moves on)
		const timer = setInterval(() => {
			clock = Date.now();
			desktopStatus()
				.then((now) => (desktop = now))
				.catch(() => {});
		}, 10_000);
		return () => clearInterval(timer);
	});

	async function attempt<T>(work: () => Promise<T>) {
		busy = true;
		problem = '';
		try {
			return await work();
		} catch (error) {
			problem = String(error);
			return null;
		} finally {
			busy = false;
		}
	}

	async function turn(on: boolean) {
		const next = await attempt(() => setClaudeEnabled(on));
		if (next) status = next;
	}

	async function allowChanges(on: boolean) {
		const next = await attempt(() => setClaudeChanges(on));
		if (next) status = next;
	}

	async function addToDesktop() {
		const next = await attempt(connectDesktop);
		if (next) {
			desktop = next;
			showToast('Stosufy is added to Claude', 'icon-[mingcute--ai-line]');
		}
	}

	async function removeFromDesktop() {
		const next = await attempt(disconnectDesktop);
		if (next) desktop = next;
	}

	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text);
		showToast(`${what} copied`, 'icon-[mingcute--copy-2-line]');
	}

	let added = $derived(client === 'desktop' ? !!desktop?.connected : !!status?.claudeCode);
	let steps = $derived([
		!!status?.enabled,
		!!desktop?.connected || !!status?.claudeCode,
		!!$claudeActivity
	]);

	function ago(at: number) {
		const minutes = Math.round((clock - at) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		return `${Math.round(minutes / 60)} h ago`;
	}
</script>

{#snippet toggle(
	label: string,
	description: string,
	checked: boolean,
	onchange: (on: boolean) => void
)}
	<label class="flex items-center justify-between gap-4 cursor-pointer">
		<span>
			<span class="block font-semibold text-white">{label}</span>
			<span class="block text-xs text-secondary-600">{description}</span>
		</span>
		<input
			type="checkbox"
			class="peer sr-only"
			{checked}
			disabled={busy || !status}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
		<span
			class="relative w-10 h-6 shrink-0 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
		></span>
	</label>
{/snippet}

{#snippet step(number: number, done: boolean, title: string, description: string)}
	<span class="flex items-start gap-3">
		<span
			class="size-6 shrink-0 grid place-items-center rounded-full text-xs font-bold transition {done
				? 'bg-primary-300 text-white'
				: 'bg-white/10 text-secondary-600'}"
			aria-label={done ? 'Done' : `Step ${number}`}
		>
			{#if done}
				<span class="icon-[mingcute--check-line] size-3.5"></span>
			{:else}
				{number}
			{/if}
		</span>
		<span class="min-w-0">
			<span class="block font-semibold text-white">{title}</span>
			<span class="block text-xs text-secondary-600">{description}</span>
		</span>
	</span>
{/snippet}

<section class="flex items-start gap-3 p-3 rounded-lg bg-primary-300/10 ring-1 ring-primary-400/30">
	<span class="icon-[mingcute--ai-line] size-6 shrink-0 text-primary-500 mt-0.5"></span>
	<span class="text-sm text-white/90">
		Connect Claude to Stosufy and ask it for music. Claude can see what you listen to, search all of
		osu!'s songs, make playlists from your listening or from a description, and play them.
		<span class="block mt-1 text-xs text-secondary-600">
			Claude reaches Stosufy only on this computer and only while you chat with it. What it looks up
			(your history, library, playlists) becomes part of that chat.
		</span>
	</span>
</section>

<ol class="flex flex-col gap-3">
	<li class="p-3 rounded-lg bg-white/[0.04]">
		{@render step(
			1,
			steps[0],
			'Turn on the connection',
			'Lets Claude reach Stosufy on this computer.'
		)}
		<div class="mt-3 ml-9 flex flex-col gap-3">
			{@render toggle(
				'Allow Claude',
				status?.enabled ? 'Claude can use Stosufy.' : 'Claude can’t reach Stosufy.',
				!!status?.enabled,
				turn
			)}
			{#if status?.enabled}
				{@render toggle(
					'Let Claude make changes',
					'Make and edit playlists, like songs, play music. Off: Claude can only look.',
					status.allowChanges,
					allowChanges
				)}
			{/if}
		</div>
	</li>

	<li
		class="p-3 rounded-lg bg-white/[0.04] {status?.enabled ? '' : 'opacity-50 pointer-events-none'}"
	>
		{@render step(
			2,
			steps[1],
			'Add Stosufy to Claude',
			'Once; Claude then starts Stosufy’s connection itself.'
		)}
		<div class="mt-3 ml-9">
			<div
				class="grid grid-cols-2 p-1 rounded-lg bg-white/[0.04]"
				role="radiogroup"
				aria-label="Which Claude"
			>
				{#each [{ value: 'desktop', label: 'Claude app', icon: 'icon-[mingcute--computer-line]' }, { value: 'code', label: 'Claude Code', icon: 'icon-[mingcute--terminal-box-line]' }] as option (option.value)}
					{@const active = client === option.value}
					<button
						role="radio"
						aria-checked={active}
						class="h-8 flex items-center justify-center gap-2 rounded-md text-sm font-semibold cursor-pointer transition {active
							? 'bg-secondary-400 text-white'
							: 'text-secondary-600 hover:text-white'}"
						onclick={() => (client = option.value as 'desktop' | 'code')}
					>
						<span class="{option.icon} size-4"></span>
						{option.label}
					</button>
				{/each}
			</div>

			{#if client === 'desktop'}
				<div class="mt-3 flex items-center justify-between gap-4">
					<span class="min-w-0 text-xs text-secondary-600" aria-live="polite">
						{#if !desktop}
							Looking for Claude…
						{:else if !desktop.installed}
							The Claude app isn’t on this computer yet (or wasn’t opened yet). Get it, open it
							once, then come back here.
						{:else if desktop.connected}
							<span class="text-white font-semibold">Stosufy is added to the Claude app.</span>
						{:else if desktop.outdated}
							Stosufy is in Claude’s settings, but for another copy of Stosufy. Update it to this
							one.
						{:else}
							Adds Stosufy to the Claude app’s settings (a copy of them is kept).
						{/if}
					</span>
					<div class="flex gap-2 shrink-0">
						{#if desktop && !desktop.installed}
							<Button type="ghost" onclick={refresh}>Check again</Button>
							<Button type="primary" onclick={() => openUrl('https://claude.ai/download')}
								>Get Claude</Button
							>
						{:else if desktop?.connected}
							<Button type="ghost" disabled={busy} onclick={removeFromDesktop}>Remove</Button>
						{:else if desktop}
							<Button type="primary" disabled={busy} onclick={addToDesktop}>
								{desktop.outdated ? 'Update' : 'Add to Claude'}
							</Button>
						{/if}
					</div>
				</div>
				{#if status}
					<details class="mt-3 group">
						<summary class="text-xs text-secondary-600 hover:text-white cursor-pointer select-none">
							Add it by hand instead
						</summary>
						<p class="mt-2 text-xs text-secondary-600">
							In Claude: Settings → Developer → Edit Config, then put this into the file
							{#if desktop?.paths?.[0]}<span class="text-white/70 break-all"
									>({desktop.paths[0]})</span
								>{/if}:
						</p>
						<div class="relative mt-2">
							<pre
								class="p-3 pr-10 rounded-lg bg-black/30 text-xs text-white/80 overflow-x-auto">{desktopConfig(
									status
								)}</pre>
							<button
								title="Copy"
								aria-label="Copy the settings for Claude"
								class="absolute top-2 right-2 size-7 grid place-items-center rounded-md text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer"
								onclick={() => copy(desktopConfig(status), 'Settings')}
							>
								<span class="icon-[mingcute--copy-2-line] size-4"></span>
							</button>
						</div>
					</details>
				{/if}
			{:else if status}
				<p class="mt-3 text-xs text-secondary-600" aria-live="polite">
					{#if added}
						<span class="text-white font-semibold">Stosufy is added to Claude Code.</span>
					{:else}
						Run this in a terminal. Claude Code then has Stosufy in every project.
					{/if}
				</p>
				<div class="relative mt-2">
					<pre
						class="p-3 pr-10 rounded-lg bg-black/30 text-xs text-white/80 whitespace-pre-wrap break-all">{claudeCodeCommand(
							status
						)}</pre>
					<button
						title="Copy"
						aria-label="Copy the command"
						class="absolute top-2 right-2 size-7 grid place-items-center rounded-md text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer"
						onclick={() => copy(claudeCodeCommand(status), 'Command')}
					>
						<span class="icon-[mingcute--copy-2-line] size-4"></span>
					</button>
				</div>
			{/if}
		</div>
	</li>

	<li class="p-3 rounded-lg bg-white/[0.04] {steps[1] ? '' : 'opacity-50'}">
		{@render step(
			3,
			steps[2],
			client === 'desktop' ? 'Restart Claude' : 'Start a new Claude Code session',
			client === 'desktop'
				? 'Quit Claude completely (also in the tray: right-click its icon → Quit) and open it again. Stosufy is then among the connectors in a new chat.'
				: 'Stosufy is then in /mcp.'
		)}
	</li>

	<li class="p-3 rounded-lg bg-white/[0.04] {steps[1] ? '' : 'opacity-50'}">
		{@render step(4, false, 'Ask Claude', 'In any language. For example:')}
		<ul class="mt-2 ml-9 flex flex-col gap-1">
			{#each EXAMPLES as example (example)}
				<li>
					<button
						class="group w-full flex items-center justify-between gap-3 px-3 h-9 rounded-md text-sm text-start text-white/90 bg-white/[0.03] hover:bg-white/[0.08] cursor-pointer transition"
						title="Copy"
						onclick={() => copy(example, 'Question')}
					>
						<span class="truncate">“{example}”</span>
						<span
							class="icon-[mingcute--copy-2-line] size-4 shrink-0 text-secondary-600 opacity-0 group-hover:opacity-100 transition"
						></span>
					</button>
				</li>
			{/each}
		</ul>
		<p class="mt-2 ml-9 text-xs text-secondary-600">
			{#if client === 'desktop'}
				Ready-made requests are in Claude too: the + button in a chat → Stosufy, e.g. “Playlist from
				my listening”.
			{:else}
				Ready-made requests are in Claude Code too: type /mcp__stosufy__ and pick one.
			{/if}
		</p>
	</li>
</ol>

{#if problem}
	<p class="text-xs text-red-400" role="alert">{problem}</p>
{/if}

<p class="flex items-center gap-2 text-xs text-secondary-600" aria-live="polite">
	<span
		class="size-2 rounded-full {status?.enabled && status?.running
			? 'bg-emerald-400'
			: 'bg-secondary-500'}"
	></span>
	{#if !status?.enabled}
		The connection is off.
	{:else if $claudeActivity}
		Claude used Stosufy {ago($claudeActivity.at)} ({$claudeActivity.tool}), {$claudeActivity.calls}
		{$claudeActivity.calls === 1 ? 'time' : 'times'} since Stosufy started.
	{:else}
		Ready. Claude hasn’t used Stosufy since it started.
	{/if}
</p>
