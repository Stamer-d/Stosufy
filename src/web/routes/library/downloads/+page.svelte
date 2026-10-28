<script>
	const base = __WEB_BASE__;
	// The downloads as a page of the tab it's opened from (the library, the settings): back,
	// and the swipe from the edge, go back there
	import DownloadsPage from '../../../DownloadsPage.svelte';
</script>

<DownloadsPage back="{base}/library" />
