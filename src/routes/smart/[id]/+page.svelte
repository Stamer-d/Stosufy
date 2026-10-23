<script>
	// A smart playlist: its songs, and the rules that choose them
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { mapDataStore } from '#lib/stores/data.ts';
	import {
		smartPlaylists,
		smartSongs,
		updateSmartPlaylist,
		deleteSmartPlaylist,
		newRule,
		FIELDS,
		OP_LABELS,
		SORTS
	} from '#lib/stores/smartPlaylists.ts';
	import { GENRES, LANGUAGES } from '#lib/genres.ts';
	import MixView from '#lib/components/MixView.svelte';
	import Select from '#lib/components/Select.svelte';

	let id = $derived(page.params.id);
	let playlist = $derived($smartPlaylists.find((p) => p.id === id) ?? null);
	// (again when the library changes, e.g. once it's loaded)
	let songs = $derived.by(() => {
		void $mapDataStore;
		return playlist ? smartSongs(playlist) : [];
	});

	// A new one opens with its rules
	let editing = $state(page.url.searchParams.has('edit'));

	const FIELD_OPTIONS = Object.entries(FIELDS).map(([value, { label }]) => ({ value, label }));
	const CHOICES = {
		genre: Object.values(GENRES).filter((g) => g !== 'Other'),
		language: Object.values(LANGUAGES).filter((l) => l !== 'Other')
	};
	const MATCH_OPTIONS = [
		{ value: 'all', label: 'all' },
		{ value: 'any', label: 'any' }
	];

	const update = (change) => updateSmartPlaylist(id, change);
	function setRule(index, change) {
		update({
			rules: playlist.rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule))
		});
	}
	const removeRule = (index) => update({ rules: playlist.rules.filter((_, i) => i !== index) });
	const addRule = () => update({ rules: [...playlist.rules, newRule('bpm')] });
	const number = (value) => (value === '' ? null : Number(value));

	let confirmDelete = $state(false);
	function remove() {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		deleteSmartPlaylist(id);
		goto('/home');
	}

	const INPUT =
		'h-10 px-3 rounded-lg bg-secondary-300 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-primary-300';
</script>

{#if playlist}
	<MixView {songs} queueId="smart:{id}" label="Smart playlist" title={playlist.title}>
		{#snippet heading()}
			<input
				class="w-full bg-transparent text-5xl font-extrabold tracking-tight outline-none rounded focus-visible:ring-2 focus-visible:ring-primary-300"
				aria-label="Name"
				value={playlist.title}
				onchange={(e) => update({ title: e.currentTarget.value.trim() || 'Smart playlist' })}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			/>
		{/snippet}
		{#snippet actions()}
			<button
				class="flex items-center gap-2 px-4 h-9 rounded-full text-sm font-semibold cursor-pointer transition {editing
					? 'bg-white text-black hover:bg-white/90'
					: 'bg-white/10 hover:bg-white/20'}"
				aria-expanded={editing}
				onclick={() => (editing = !editing)}
			>
				<span class="icon-[mingcute--filter-line] size-4"></span>
				{editing ? 'Done' : 'Edit rules'}
			</button>
			<button
				class="ml-auto text-sm underline underline-offset-2 cursor-pointer transition {confirmDelete
					? 'text-red-400 hover:text-red-300'
					: 'text-secondary-600 hover:text-white'}"
				onclick={remove}
				onblur={() => (confirmDelete = false)}
			>
				{confirmDelete ? 'Click again to delete it' : 'Delete'}
			</button>
		{/snippet}

		{#if editing}
			<section
				class="mx-8 mb-6 p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5 flex flex-col gap-3"
			>
				<div class="flex flex-wrap items-center gap-2 text-sm">
					Songs that match
					<Select
						label="Match"
						hideLabel
						options={MATCH_OPTIONS}
						value={playlist.match}
						onchange={(match) => update({ match })}
					/>
					of these rules
				</div>

				{#each playlist.rules as rule, index (index)}
					{@const field = FIELDS[rule.field]}
					<div class="flex flex-wrap items-center gap-2">
						<Select
							label="Rule"
							hideLabel
							options={FIELD_OPTIONS}
							value={rule.field}
							onchange={(value) => setRule(index, newRule(/** @type {any} */ (value)))}
						/>
						<Select
							label="Comparison"
							hideLabel
							options={field.ops.map((op) => ({ value: op, label: OP_LABELS[op] }))}
							value={rule.op}
							onchange={(op) => setRule(index, { op })}
						/>
						{#if field.input === 'number'}
							<input
								type="number"
								min="0"
								step={rule.field === 'stars' ? 0.1 : 1}
								class="{INPUT} w-24"
								aria-label="{field.label} value"
								value={rule.value ?? ''}
								oninput={(e) => setRule(index, { value: number(e.currentTarget.value) })}
							/>
							{#if rule.op === 'between'}
								<span class="text-sm text-secondary-600">and</span>
								<input
									type="number"
									min="0"
									step={rule.field === 'stars' ? 0.1 : 1}
									class="{INPUT} w-24"
									aria-label="{field.label} upper value"
									value={rule.value2 ?? ''}
									oninput={(e) => setRule(index, { value2: number(e.currentTarget.value) })}
								/>
							{/if}
							{#if field.unit}
								<span class="text-sm text-secondary-600">{field.unit}</span>
							{/if}
						{:else if field.input === 'text'}
							<input
								class="{INPUT} w-56"
								aria-label="{field.label} value"
								placeholder="Type a name"
								value={rule.value ?? ''}
								oninput={(e) => setRule(index, { value: e.currentTarget.value })}
							/>
						{:else if field.input === 'choice'}
							<Select
								label={field.label}
								hideLabel
								options={CHOICES[field.choices].map((value) => ({ value, label: value }))}
								value={String(rule.value || CHOICES[field.choices][0])}
								onchange={(value) => setRule(index, { value })}
							/>
						{/if}
						<button
							title="Remove rule"
							aria-label="Remove the {field.label} rule"
							class="size-9 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer transition"
							onclick={() => removeRule(index)}
						>
							<span class="icon-[mingcute--close-line] size-4"></span>
						</button>
					</div>
				{/each}

				<button
					class="self-start flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold bg-white/10 hover:bg-white/20 cursor-pointer transition"
					onclick={addRule}
				>
					<span class="icon-[mingcute--add-line] size-4"></span>
					Add rule
				</button>

				<div class="flex flex-wrap items-center gap-3 pt-3 border-t border-white/5">
					<Select
						label="Order"
						options={SORTS}
						value={playlist.sort}
						onchange={(sort) => update({ sort })}
					/>
					<label class="flex items-center gap-2 text-sm text-secondary-600">
						At most
						<input
							type="number"
							min="1"
							class="{INPUT} w-24"
							placeholder="all"
							value={playlist.limit ?? ''}
							oninput={(e) => update({ limit: number(e.currentTarget.value) || null })}
						/>
						songs
					</label>
				</div>
			</section>
		{/if}

		{#snippet empty()}
			<p class="px-8 py-10 text-center text-secondary-600">
				No song of your library matches these rules (yet).
			</p>
		{/snippet}
	</MixView>
{:else}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--magic-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">This smart playlist isn't here anymore</p>
		<a href="/home" class="mt-2 text-sm font-semibold hover:underline">Go home</a>
	</div>
{/if}
