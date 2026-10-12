<script>
	// Asks for the osu! session key: downloading beatmaps needs it (osu! only gives them to
	// logged in users), everything else works without it
	import Modal from './Modal.svelte';
	import Input from './Input.svelte';
	import Button from './Button.svelte';
	import { keyStore, checkSessionKey, sessionKeyNeeded } from '#lib/stores/auth.ts';
	import { resumeDownloads } from '#lib/stores/downloadQueue.ts';
	import { showToast } from '#lib/stores/toast.ts';

	let key = $state('');
	let checking = $state(false);
	let error = $state('');
	let showSteps = $state(false);

	// The modal closes itself (Esc, outside click): the store follows it
	let open = $state(false);
	$effect(() => {
		if ($sessionKeyNeeded && !open) {
			key = $keyStore.sessionKey ?? '';
			error = '';
			open = true;
		}
	});
	$effect(() => {
		if (!open) sessionKeyNeeded.set(false);
	});

	async function save() {
		const value = key.trim();
		if (!value) {
			error = 'Paste your session key first.';
			return;
		}
		checking = true;
		try {
			const check = await checkSessionKey(value);
			if (!check.status) {
				error =
					check.status_code === 429
						? 'Too many attempts. Please try again in a bit.'
						: "osu! didn't accept this key. Check that you copied the whole osu_session value.";
				return;
			}
			$keyStore.sessionKey = check.session_key ?? value;
			open = false;
			showToast('Session key saved: downloads work now', 'icon-[mingcute--check-circle-line]');
			resumeDownloads();
		} catch {
			error = "Couldn't reach osu! to check the key.";
		} finally {
			checking = false;
		}
	}
</script>

<Modal bind:open title="Add your session key to download" width="520px">
	<div class="flex flex-col gap-4">
		<p class="text-sm leading-relaxed text-secondary-600">
			osu! only gives beatmap downloads to logged in users, so Stosufy needs your
			<code class="text-white/80">osu_session</code> cookie for them. Everything else (your osu! folder,
			searching, playlists, friends) works without it. It stays on this device.
		</p>
		<form
			class="flex flex-col gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<Input
				id="session-key-prompt"
				bind:value={key}
				type="password"
				placeholder="Paste your session key"
			/>
			{#if error}<p class="text-sm text-red-400" role="alert">{error}</p>{/if}
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="text-sm font-semibold text-secondary-600 hover:text-white cursor-pointer"
					onclick={() => (showSteps = !showSteps)}
				>
					{showSteps ? 'Hide the steps' : 'Where do I find it?'}
				</button>
				<span class="flex-1"></span>
				<Button type="primary" disabled={checking} on:click={save}>
					{checking ? 'Checking…' : 'Save key'}
				</Button>
			</div>
		</form>
		{#if showSteps}
			<ol class="list-decimal list-inside text-sm leading-relaxed text-secondary-600">
				<li>Log in to osu.ppy.sh in your browser.</li>
				<li>Press <code>F12</code> to open the developer tools.</li>
				<li>
					Open <strong>Application</strong> (Chrome) or <strong>Storage</strong> (Firefox) → Cookies →
					https://osu.ppy.sh.
				</li>
				<li>Copy the value of <code>osu_session</code> and paste it here.</li>
			</ol>
		{/if}
	</div>
</Modal>
