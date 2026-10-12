<script>
	// A mapper's name that opens their profile, like in osu!lazer. It works inside buttons
	// (it is no button itself) and doesn't trigger what is around it.
	import { goto } from '$app/navigation';

	/** @type {{ name: string | undefined | null, id?: number | string | null, class?: string }} */
	let { name, id = null, class: className = '' } = $props();

	function openProfile(event) {
		event.stopPropagation();
		event.preventDefault();
		goto(`/profile/${id ? id : encodeURIComponent(`@${name}`)}`);
	}
</script>

{#if name}
	<span
		role="link"
		tabindex="0"
		title="{name}'s profile"
		class="cursor-pointer font-semibold hover:underline hover:text-primary-400 {className}"
		onclick={openProfile}
		onkeydown={(event) => event.key === 'Enter' && openProfile(event)}>{name}</span
	>
{/if}
