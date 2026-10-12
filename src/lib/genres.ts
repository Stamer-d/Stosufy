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

/** The tags of a set as a list (osu! keeps them as one string, separated by spaces) */
export function tagList(tags: string | undefined | null) {
	return [...new Set((tags ?? '').split(/\s+/).filter((tag) => tag.length > 1))];
}
