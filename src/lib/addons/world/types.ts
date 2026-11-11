// The world center's shared shapes: its categories, the area a map shows, what a tracker
// puts on the map (features) and what its panel shows about one of them (details).

export type Category = 'weather' | 'earth' | 'environment' | 'traffic' | 'space' | 'cameras';

/** What the map shows: its edges, middle and zoom */
export interface Area {
	north: number;
	south: number;
	west: number;
	east: number;
	lat: number;
	lon: number;
	zoom: number;
}

export type Shape =
	| 'dot'
	| 'ring'
	| 'triangle'
	| 'square'
	| 'diamond'
	| 'arrow'
	| 'boat'
	| 'camera'
	| 'star'
	| 'plus';

/** One thing on the map */
export interface Feature {
	id: string;
	lat: number;
	lon: number;
	shape?: Shape;
	colour: string;
	/** Half its width, px */
	size?: number;
	/** Degrees from north (arrows and boats point that way) */
	heading?: number;
	/** Written beside it from `labelZoom` on (always when not given) */
	label?: string;
	labelZoom?: number;
	/** A ring spreads from it: new, or a warning */
	pulse?: boolean;
	/** Where it is at a time, for things that move (vehicles on their line, satellites) */
	at?: (now: number) => { lat: number; lon: number; heading?: number } | null;
	/** A line under it, of [lon, lat] (its route, its track, a boundary) */
	line?: [number, number][];
	lineColour?: string;
	/** Areas, rings of [lon, lat], filled */
	area?: [number, number][][];
	/** The higher, the more on top */
	rank?: number;
	/** Whatever its tracker needs for the details */
	data?: any;
}

/** What the panel shows about a feature */
export interface Details {
	title: string;
	subtitle?: string;
	/** The big square at the top (a magnitude, a level) */
	badge?: { text: string; colour: string; small?: string };
	/** A picture (refreshed every `every` ms), or a video, or a page shown inside */
	image?: { url: string; every?: number; video?: string; embed?: string; caption?: string };
	text?: string;
	stats?: { label: string; value: string; hint?: string }[];
	/** A list, like the next departures */
	rows?: { title: string; sub?: string; value?: string; colour?: string; badge?: string }[];
	rowsTitle?: string;
	links?: { label: string; url: string }[];
	/** Buttons that do something in the app (like putting it on the home screen) */
	actions?: { label: string; icon: string; run: () => void }[];
	/** Who the data comes from */
	source: string;
}

export interface LayerStatus {
	/** `unavailable`: its key isn't set up on the server */
	state: 'off' | 'loading' | 'ok' | 'error' | 'zoom' | 'unavailable';
	/** Shown in the layer's row: how many there are */
	count?: number;
	error?: string;
	/** ms, when it was loaded last */
	at?: number;
}

/** A tracker: where it gets its features from and what it says about them */
export interface LayerSource {
	id: string;
	category: Category;
	label: string;
	icon: string;
	/** What it shows, for the tooltip */
	hint: string;
	attribution: string;
	/** On while nothing was chosen */
	on?: boolean;
	/** Nothing is loaded below this zoom (too much at once) */
	minZoom?: number;
	/** ms between loads while it's shown */
	every: number;
	/** Loaded for the area shown (again when the map moves on); else once for the world */
	byArea?: boolean;
	/** Its features move: drawn on every frame */
	moving?: boolean;
	load: (area: Area, signal: AbortSignal) => Promise<Feature[]>;
	details: (feature: Feature, signal: AbortSignal) => Details | Promise<Details>;
	/** What the colours mean */
	legend?: { label: string; colour: string }[];
}

/** A map coloured by a value over an area (like the air quality) */
export interface FieldSource {
	id: string;
	label: string;
	icon: string;
	hint: string;
	unit: string;
	attribution: string;
	/** Values for the legend */
	legend: number[];
	colour: (value: number) => [number, number, number, number];
	format?: (value: number) => string;
	/** ms between loads */
	every: number;
	load: (
		area: Area,
		signal: AbortSignal
	) => Promise<{ rows: { lat: number; lon: number; value: number }[][]; time?: number }>;
}
