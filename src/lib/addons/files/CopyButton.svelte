<script>
	// "Copy": what was made, on the clipboard (text, a picture, or the file itself), so it can
	// be pasted somewhere without looking for it in its folder.
	import { showToast } from '#lib/stores/toast.ts';
	import { copyToClipboard, COPIED_TEXT } from './clipboard.ts';

	/** @type {{ files: import('./save.ts').SavedFile[], label?: string }} */
	let { files, label = 'Copy' } = $props();

	let copied = $state(false);
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;

	function copy() {
		copyToClipboard(files)
			.then((how) => {
				copied = true;
				clearTimeout(timer);
				timer = setTimeout(() => (copied = false), 2000);
				showToast(COPIED_TEXT[how], 'icon-[mingcute--copy-2-line]');
			})
			.catch((error) => {
				console.warn('Could not copy it:', error);
				showToast("Couldn't copy it", 'icon-[mingcute--warning-line]');
			});
	}
</script>

<button
	class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold cursor-pointer transition {copied
		? 'bg-emerald-400/15 text-emerald-300'
		: 'bg-white/[0.08] hover:bg-white/15'}"
	aria-label="{label} {files.map((file) => file.name).join(', ')}"
	title="Copy it, to paste it anywhere (Ctrl+V)"
	onclick={copy}
>
	<span class="{copied ? 'icon-[mingcute--check-line]' : 'icon-[mingcute--copy-2-line]'} size-4"
	></span>
	{copied ? 'Copied' : label}
</button>
