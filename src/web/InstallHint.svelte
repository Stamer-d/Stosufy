<script module>
	// (Android's browsers offer the app once, early: kept for the button)
	/** @type {any} */
	let offered = null;
	if (typeof window !== 'undefined')
		window.addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			offered = event;
		});
</script>

<script>
	// Opened in the browser, not from the home screen: how to install it. On an iPhone it
	// matters more than it looks: Safari and the installed app keep their own logins and
	// downloads (what's kept in one isn't in the other), Safari may clear a site's data after
	// a week without a visit, and only the installed app plays on like an app. Until it's
	// closed with the ×.
	import { onMount } from 'svelte';
	import { haptic } from './haptics';

	const KEY = 'stosufy-web-install-hint';
	let shown = $state(false);
	let ios = $state(false);
	let canOffer = $state(false);

	onMount(() => {
		const standalone =
			matchMedia('(display-mode: standalone)').matches ||
			!!(/** @type {any} */ (navigator).standalone);
		let closed = false;
		try {
			closed = !!localStorage.getItem(KEY);
		} catch {
			// (shown then)
		}
		// (iPads ask as a Mac, with a touch screen)
		ios =
			/iPhone|iPad|iPod/.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		canOffer = !!offered;
		shown = !standalone && !closed && (ios || canOffer);
	});

	function close() {
		haptic();
		shown = false;
		try {
			localStorage.setItem(KEY, String(Date.now()));
		} catch {
			// (only for now)
		}
	}

	async function install() {
		haptic();
		offered?.prompt();
		const choice = await offered?.userChoice.catch(() => null);
		offered = null;
		canOffer = false;
		if (choice?.outcome === 'accepted') shown = false;
	}
</script>

{#if shown}
	<section
		class="relative flex gap-3 p-4 pr-11 rounded-xl bg-white/[0.06] ring-1 ring-white/10 text-start"
		aria-label="Install Stosufy"
	>
		<span class="icon-[mingcute--cellphone-line] size-7 shrink-0 text-primary-400"></span>
		<div class="min-w-0 text-sm">
			<p class="font-semibold text-white">Put Stosufy on your home screen</p>
			<p class="mt-1 text-secondary-600">
				Then it opens as an app, plays on with the screen locked and keeps your downloads.
			</p>
			{#if ios}
				<p class="mt-2 text-white/80">
					Tap <span class="icon-[lucide--share] size-4 align-[-3px]"></span>
					<b>Share</b>, then
					<span class="icon-[mingcute--add-square-line] size-4 align-[-3px]"></span>
					<b>Add to Home Screen</b>.
				</p>
				<p class="mt-1 text-xs text-secondary-600">
					Log in there: what's here in the browser stays here.
				</p>
			{:else if canOffer}
				<button class="mt-3 h-11 px-5 rounded-full bg-primary-300 font-semibold" onclick={install}>
					Install
				</button>
			{/if}
		</div>
		<button
			aria-label="Don't show this again"
			class="absolute top-1 right-1 size-11 grid place-items-center text-secondary-600"
			onclick={close}
		>
			<span class="icon-[mingcute--close-line] size-5"></span>
		</button>
	</section>
{/if}
