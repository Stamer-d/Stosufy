// osu!'s genres and languages of beatmaps (the ids its API and search use)

export const GENRES: Record<number, string> = {
	2: 'Video Game',
	3: 'Anime',
	4: 'Rock',
	5: 'Pop',
	6: 'Other',
	7: 'Novelty',
	9: 'Hip Hop',
	10: 'Electronic',
	11: 'Metal',
	12: 'Classical',
	13: 'Folk',
	14: 'Jazz'
};

export const LANGUAGES: Record<number, string> = {
	2: 'English',
	3: 'Japanese',
	4: 'Chinese',
	5: 'Instrumental',
	6: 'Korean',
	7: 'French',
	8: 'German',
	9: 'Swedish',
	10: 'Spanish',
	11: 'Italian',
	12: 'Russian',
	13: 'Polish',
	14: 'Other'
};

/**
 * osu! names genres and languages in the user's language (the library keeps whatever it got
 * then, so one library can have "Video Game" and "Videospiel"): those names in English
 */
const TRANSLATED: Record<string, string> = {
	// German
	videospiel: 'Video Game',
	andere: 'Other',
	hiphop: 'Hip Hop',
	elektronisch: 'Electronic',
	klassik: 'Classical',
	englisch: 'English',
	japanisch: 'Japanese',
	chinesisch: 'Chinese',
	koreanisch: 'Korean',
	franzosisch: 'French',
	deutsch: 'German',
	schwedisch: 'Swedish',
	spanisch: 'Spanish',
	italienisch: 'Italian',
	russisch: 'Russian',
	polnisch: 'Polish'
};
const nameKey = (name: string) =>
	name
		.normalize('NFKD')
		.replace(/[^a-z]/gi, '')
		.toLowerCase();
const ENGLISH = new Map(
	[...Object.values(GENRES), ...Object.values(LANGUAGES)].map((name) => [nameKey(name), name])
);

/** A genre or language as osu! names it in English (as it is, if it's none it knows) */
export function englishName(name: string | null | undefined) {
	if (!name) return name ?? null;
	const key = nameKey(name);
	return ENGLISH.get(key) ?? TRANSLATED[key] ?? name;
}

/** The tags of a set as a list (osu! keeps them as one string, separated by spaces) */
export function tagList(tags: string | undefined | null) {
	return [...new Set((tags ?? '').split(/\s+/).filter((tag) => tag.length > 1))];
}
