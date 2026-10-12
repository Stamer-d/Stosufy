<script>
	// A note to write on (kept with the layout)
	import Widget from './MacWidget.svelte';
	import { widgetData, setWidgetData } from '#lib/stores/widgetData.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'note' } = $props();

	let saved = $derived($widgetData[uid]?.text ?? '');
	let text = $state(null);
	let timer;

	function input(event) {
		text = event.currentTarget.value;
		clearTimeout(timer);
		// Saved a moment after the last key
		timer = setTimeout(() => setWidgetData(uid, { text }), 600);
	}
</script>

<Widget size="small" class="!bg-amber-200/85 !text-amber-950 !ring-amber-100/40">
	<textarea
		value={text ?? saved}
		oninput={input}
		placeholder="Write something…"
		class="flex-1 w-full resize-none bg-transparent text-sm font-medium leading-snug outline-none placeholder:text-amber-950/50"
	></textarea>
</Widget>
