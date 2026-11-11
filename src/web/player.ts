// The web app's player: an <audio> element (iOS keeps that playing in the background and on
// the lock screen, where its controls come from the Media Session), its sound through Web
// Audio once that runs (audioGraph.ts: every song at the same loudness, crossfades; a second
// element takes the next song for a crossfade).
// With the screen locked a page may go on playing, but hardly start to: so the next song is
// made ready in the second element while this one still plays, and takes over at its end
// without a moment of silence in between (see "The next song, ahead of time").
// The songs stream from the beatmap mirror, like the desktop app's streaming, or play from
// the phone if they were downloaded. The queue, shuffle and repeat are kept for the next
// start, where it goes on where it was.

import { get, writable } from 'svelte/store';
import { downloaded, localUrl } from './downloads';
import { coverUrl, keyOf, previewUrl, slim, streamUrl } from './songs';
import { log } from './log';
import { sharpArtwork } from './covers';
import {
	wakeGraph,
	whenRunning,
	keepRunning,
	isRouted,
	graphRunning,
	fadeTo,
	unfade,
	crossfadeSeconds,
	holdAudio
} from './audioGraph';
import { startLoudness, measure, applyNormalize } from './loudness';
import { userSettings } from './shims/user';
import { applyMod } from '../lib/stores/mods';
import { askDuration, songDuration, knownDuration, formatOf } from './duration';
import { offline } from '../lib/stores/network';
import type { MapSet } from '../lib/types';

export { streamUrl, coverUrl, bigCoverUrl, slim } from './songs';

export type Repeat = 'off' | 'all' | 'one';

export const queue = writable<{ songs: MapSet[]; index: number }>({ songs: [], index: -1 });
export const playing = writable(false);
export const time = writable({ current: 0, duration: 0 });
/** The song plays its 30 s preview (the mirror didn't have it) */
export const previewOnly = writable(false);
export const shuffle = writable(false);
export const repeat = writable<Repeat>('off');
/** The full screen player is open */
export const playerOpen = writable(false);
/** At the end of the queue, songs like the ones before play on (the radio's) */
export const autoplay = writable(true);
/** Songs like these, without those (set by listening.ts: the radio) */
let similarTo: ((seeds: MapSet[], exclude: MapSet[]) => MapSet[]) | null = null;
export function setSimilarSongs(find: typeof similarTo) {
	similarTo = find;
}

/**
 * Autoplay: with fewer than two songs left, songs like the last ones are added, ahead of
 * time (with the screen locked, the next song has to be there already when one ends)
 */
function topUp() {
	const { songs, index } = get(queue);
	if (!get(autoplay) || get(repeat) !== 'off' || !similarTo || songs.length - index - 1 >= 2)
		return;
	const more = similarTo(songs.slice(-5).reverse(), songs).slice(0, 20).map(slim);
	if (!more.length) return;
	log(`autoplay: ${more.length} songs like these`);
	queue.update((q) => ({ ...q, songs: [...q.songs, ...more] }));
	ordered.push(...more);
	readNext();
}

/** The sleep timer: when it stops (ms), or at the end of the song playing */
export const sleepTimer = writable<{ at: number } | { endOfSong: true } | null>(null);
/** The <audio> element, once there (the listening history looks at it) */
export const audioElement = writable<HTMLAudioElement | null>(null);

/** The queue in the order it was played in (to go back to when shuffle is turned off) */
let ordered: MapSet[] = [];
let audio: HTMLAudioElement | null = null;
/** The other element: the next song comes in on it in a crossfade (then they swap) */
let spare: HTMLAudioElement | null = null;
/** The song going out in a crossfade, while it fades */
let outgoing: HTMLAudioElement | null = null;
/** A crossfade into the next song is on its way (or was turned down for this song) */
let crossfading = false;
let objectUrl: string | null = null;
/** The next song's downloaded audio, read ahead: iOS starts a song with the screen locked
 * only if it's started right away when the one before ends (no waiting on anything) */
let readAhead: { key: string; url: string } | null = null;
/** Where the song was at the last timeupdate (to see it go round to the start) */
let lastTime = 0;
/** The position was changed by hand (going back to the start isn't the song's end then) */
let seekedByHand = false;
/** The song's end was seen by its known length (once, until it's before its end again) */
let endedHere = false;
/** The song in the <audio> element (none after a start: it loads at the first play) */
let loaded: MapSet | null = null;
/** The app paused it itself (else it was the system: a call, Siri, headphones out…) */
let pausing = false;
/** Tries to get a stream going again after it broke off, for the song now */
let retries = 0;
/** The phone didn't let a song start (the screen locked): it starts when the app is shown */
let turnedDown = false;

/** A start the phone turned down: said in the log, and made up for when the app is shown */
function startTurnedDown(error: { name?: string } | null) {
	log(`play() turned down: ${error?.name}`);
	if (error?.name === 'NotAllowedError') turnedDown = true;
}

/** Where a jump the app made goes, until the song is there, and when it was made (a stream
 * takes a while to get there, and tells its old place meanwhile) */
let jumpingTo: number | null = null;
let jumpedAt = 0;
function jumped(seconds: number) {
	lastTime = seconds;
	jumpingTo = seconds;
	jumpedAt = performance.now();
}

/**
 * The element goes to `at` (s) of its new source: right away, and again once it knows how long
 * the song is (before that, browsers may forget it and start from the beginning)
 */
function startAt(player: HTMLAudioElement, at: number, song: MapSet) {
	jumped(at);
	if (!at) return;
	player.currentTime = at;
	player.addEventListener(
		'loadedmetadata',
		() => {
			if (loaded === song && player.currentTime < at - 1) player.currentTime = at;
		},
		{ once: true }
	);
}

/**
 * The song went back by itself (it loops: round to its start, its end), wherever it is by
 * the time that's seen (with the screen locked the time updates may come late). A jump the
 * app made itself isn't one: not judged until the song is where it was sent.
 */
function wentRound(player: HTMLAudioElement) {
	const now = player.currentTime;
	if (jumpingTo != null) {
		if (Math.abs(now - jumpingTo) > 2 && performance.now() - jumpedAt < 6000) return false;
		jumpingTo = null;
		lastTime = now;
		return false;
	}
	const round = lastTime > 5 && now < lastTime - 3;
	lastTime = now;
	return round;
}

/** Pauses, as the app (not the system) */
function pauseHere(why: string) {
	pausing = true;
	log(`pause (${why})`);
	element().pause();
	// (the song going out of a crossfade stops with it)
	endCrossfade();
}

function shuffled<T>(list: T[]) {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/**
 * The <audio> element. It loops: when a song ends by itself, iOS closes the app's audio and
 * doesn't let it start again with the screen locked, so a song never ends: going round to
 * its start is its end, and the next one starts in the same running audio. (Or, with a
 * crossfade, in the other element, which then is the one.)
 */
function element() {
	if (audio) return audio;
	audio = create();
	audioElement.set(audio);
	setupMediaSession();
	return audio;
}

/** An element for the songs; what it tells counts only while it's the one (`audio`) */
function create() {
	const player = new Audio();
	// (its sound is read by Web Audio: the songs' servers let it, see songs.ts)
	player.crossOrigin = 'anonymous';
	player.preload = 'auto';
	player.loop = true;
	const mine = () => player === audio;
	player.addEventListener('play', () => {
		if (!mine()) return;
		playing.set(true);
		turnedDown = false;
		keepRunning();
		holdAudio(true);
	});
	player.addEventListener('pause', () => {
		if (!mine()) return;
		playing.set(false);
		holdAudio(false);
		// (not the app: it says who, so the log shows why a song stopped by itself)
		if (!pausing && !player.ended)
			log(
				`paused by ${document.hidden ? 'the system, in the background' : 'the system'} (a call, Siri, headphones, another app's sound?)`
			);
		pausing = false;
		endCrossfade();
	});
	player.addEventListener('stalled', () => mine() && log('stream stalled'));
	player.addEventListener('waiting', () => mine() && log('waiting for the stream'));
	// iOS forgets the lock screen's buttons when a song starts: set again each time
	player.addEventListener('playing', () => {
		if (!mine()) return;
		setupMediaSession();
		updatePosition();
		log(`playing ${current()?.title ?? ''}`);
	});
	player.addEventListener('timeupdate', () => {
		if (!mine()) return;
		const now = player.currentTime;
		const duration = lengthOf(player);
		time.set({ current: now, duration });
		// (back at its start by itself: its end. Not by its length: Safari may get that wrong)
		const round = wentRound(player);
		// (or at its end by the length the Stosufy API knows: Safari, thinking the song longer
		// than it is, may stand at the end of its sound, and with the screen locked nothing else
		// notices then: the queue stood still)
		const sure = get(previewOnly) ? 0 : knownDuration(loaded);
		if (sure && now < sure - 2) endedHere = false;
		const atItsEnd = !!sure && now >= sure - 0.25 && !endedHere;
		const sleep = get(sleepTimer);
		if (sleep && 'at' in sleep && Date.now() >= sleep.at) {
			sleepTimer.set(null);
			pauseHere('sleep timer');
		}
		if (now > 1) retries = 0;
		// (its sound through Web Audio, which iOS stopped: a call, Siri. On again)
		if (isRouted(player) && !graphRunning()) keepRunning();
		measure();
		if (round && !seekedByHand) {
			log('song went round: its end');
			songEnded();
		} else if (atItsEnd && !seekedByHand) {
			endedHere = true;
			log('at its end (its known length)');
			songEnded();
		} else if (!seekedByHand) {
			crossfadeIfDue(now, duration);
			prepareIfDue(now, duration);
		}
		seekedByHand = false;
		saveSoon();
	});
	// (going round is a jump to the start: seen here right away, the time updates may come
	// late with the screen locked)
	player.addEventListener('seeking', () => {
		if (!mine() || seekedByHand || !wentRound(player)) return;
		log('song went round: its end');
		songEnded();
	});
	player.addEventListener('loadedmetadata', () => mine() && updatePosition());
	// (a speed mod: the lock screen's position runs at its speed)
	player.addEventListener('ratechange', () => mine() && updatePosition());
	// (it loops, so only if that didn't work)
	player.addEventListener('ended', () => {
		if (!mine()) return;
		log('ended');
		songEnded();
	});
	player.addEventListener('error', () => {
		const song = current();
		if (!mine() || !song || player.src.startsWith('blob:')) return;
		const code = player.error?.code;
		// It played and the stream broke off (the connection, a moment): on from where it was,
		// a few times, waiting a bit longer each time
		const at = lastTime;
		if (!get(previewOnly) && at > 1 && retries < 4) {
			retries++;
			log(`stream broke off at ${Math.round(at)}s (error ${code}): again, try ${retries}`);
			setTimeout(() => {
				if (current() !== song || !mine()) return;
				player.src = streamUrl(song);
				startAt(player, at, song);
				player.play().catch(startTurnedDown);
			}, 1000 * retries);
			return;
		}
		// The mirror didn't have the song (or has a break): its preview instead
		if (!get(previewOnly)) {
			log(`no stream for ${song.title} (error ${code}): its preview`);
			previewOnly.set(true);
			lastTime = 0;
			player.src = previewUrl(song);
			player.play().catch(() => {});
			return;
		}
		// Not even that (offline, and it isn't downloaded): the next one
		log(`can't play ${song.title} (error ${player.error?.code})`);
		setTimeout(() => current() === song && next(), 800);
	});
	return player;
}

/** A tiny silent sound: the spare element plays it once from a tap (iOS lets an element play
 * by itself later only after it played from one) */
const SILENCE =
	'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let spareReady = false;

/**
 * From a tap: the songs' Web Audio started (and the elements routed once it runs), and the
 * spare element made ready to play by itself (the next song starts in it)
 */
export function wakeAudio() {
	const main = element();
	spare ??= create();
	if (!spareReady && !spare.src) {
		spareReady = true;
		spare.src = SILENCE;
		spare.play().then(
			() => spare?.src === SILENCE && spare.pause(),
			() => (spareReady = false)
		);
	}
	wakeGraph([main, spare]);
}
/** How long the song in this element is (Safari's guess only when it can be: duration.ts) */
const lengthOf = (player: HTMLAudioElement) =>
	songDuration(player === audio ? loaded : null, player.duration);

const current = () => {
	const { songs, index } = get(queue);
	return songs[index] ?? null;
};

/**
 * Plays the queue's current song: right away (a stream, or a download read ahead), only a
 * download that wasn't read ahead waits for it to be read
 */
function load(at = 0) {
	const song = current();
	if (!song) return;
	const player = element();
	endCrossfade();
	// (a song made ready for after this one isn't the one now; its downloaded audio is)
	handing?.stop();
	handing = null;
	dropPrepared();
	loaded = song;
	previewOnly.set(false);
	showInMediaSession(song);
	const key = keyOf(song);
	const start = (url: string, own: boolean) => {
		if (objectUrl && objectUrl !== url) URL.revokeObjectURL(objectUrl);
		objectUrl = own ? url : null;
		crossfading = false;
		unfade(player);
		startLoudness(player, key);
		askDuration(song);
		// (the line at the new song's start right away, at its length as far as it's known:
		// not the song before's place for a moment, then a length that jumps)
		time.set({ current: at, duration: songDuration(song, Number.NaN) });
		player.src = url;
		startAt(player, at, song);
		const format = formatOf(song);
		log(`start ${song.title} (${own ? 'downloaded' : 'stream'}${format ? `, ${format}` : ''})`);
		player.play().catch(startTurnedDown);
		save();
		topUp();
		readNext();
	};
	if (readAhead?.key === key) {
		const { url } = readAhead;
		readAhead = null;
		start(url, true);
	} else if (get(downloaded).has(key)) {
		return localUrl(song).then((url) => {
			if (current() === song) start(url ?? streamUrl(song), !!url);
			else if (url) URL.revokeObjectURL(url);
		});
	} else start(streamUrl(song), false);
}

/** Reads the next song's audio ahead if it's downloaded */
async function readNext() {
	const { songs, index } = get(queue);
	const upcoming = songs[index + 1] ?? (get(repeat) === 'all' ? songs[0] : null);
	if (!upcoming) return;
	const key = keyOf(upcoming);
	if (readAhead?.key === key || !get(downloaded).has(key)) return;
	const url = await localUrl(upcoming);
	if (!url) return;
	if (readAhead) URL.revokeObjectURL(readAhead.url);
	readAhead = { key, url };
}

/** (from a tap in the app: in the background there's none) */
const wakeIfShown = () => !document.hidden && wakeAudio();

// --- Crossfade ------------------------------------------------------------------------------
// The next song starts in the spare element `crossfade` seconds before this one ends, fading
// in while this one fades out; then it's the one. Only when the songs' sound goes through Web
// Audio (else no fades), and if iOS lets the spare element play (else, as without: the next
// song when this one ends).

/** The song after this one when it ends by itself (null: none, the queue stops) */
function upcomingIndex() {
	const { songs, index } = get(queue);
	const after = playableAfter(songs, index);
	if (after >= 0 && after < songs.length) return after;
	if (get(repeat) !== 'all') return null;
	const first = playableAfter(songs, -1);
	return first >= 0 && first < songs.length ? first : null;
}

function crossfadeIfDue(now: number, duration: number) {
	const seconds = crossfadeSeconds();
	if (!seconds || crossfading || !duration || duration < seconds * 3) return;
	if (now < duration - seconds || now > duration - 0.5) return;
	const sleep = get(sleepTimer);
	if (get(repeat) === 'one' || (sleep && 'endOfSong' in sleep)) return;
	const main = audio!;
	if (!isRouted(main) || !spare || !isRouted(spare) || !graphRunning()) return;
	const at = upcomingIndex();
	if (at == null) return;
	const { songs } = get(queue);
	const song = songs[at];
	const key = keyOf(song);
	// (a downloaded song not read ahead would wait for the phone: as without crossfade then)
	const url =
		readAhead?.key === key ? readAhead.url : get(downloaded).has(key) ? null : streamUrl(song);
	if (!url) return;
	crossfading = true;
	const incoming = spare;
	const was = current();
	if (readAhead?.key === key) readAhead = null;
	fadeTo(incoming, 0, 0);
	incoming.src = url;
	// (at the speed of the mod: the beat goes on)
	applyMod(incoming);
	log(`crossfade into ${song.title} (${seconds}s)`);
	incoming.play().then(
		() => {
			// (another song meanwhile, or paused: not this one then)
			if (audio !== main || main.paused || current() !== was) {
				release(incoming, key, url);
				return;
			}
			takeOver(incoming, main, at, song, url, seconds);
		},
		(error) => {
			// (turned down: iOS, with the screen locked. The next song when this one ends then)
			log(`crossfade turned down (${error?.name}): the next song at the end`);
			release(incoming, key, url);
		}
	);
}

/** The song in the other element is the one now: `seconds` of both together (0: at once) */
function takeOver(
	incoming: HTMLAudioElement,
	main: HTMLAudioElement,
	at: number,
	song: MapSet,
	url: string,
	seconds: number
) {
	// (a song still going out of a crossfade before stops now)
	endCrossfade();
	outgoing = main;
	spare = main;
	audio = incoming;
	// (the song going out still plays from its downloaded audio: let go of it at the end)
	outgoingUrl = objectUrl;
	objectUrl = url.startsWith('blob:') ? url : null;
	queue.set({ songs: get(queue).songs, index: at });
	loaded = song;
	lastTime = 0;
	jumpingTo = null;
	endedHere = false;
	// (its own end can crossfade again)
	crossfading = false;
	retries = 0;
	previewOnly.set(false);
	audioElement.set(incoming);
	startLoudness(incoming, keyOf(song));
	askDuration(song);
	time.set({ current: 0, duration: songDuration(song, Number.NaN) });
	showInMediaSession(song);
	fadeTo(incoming, 1, seconds);
	if (seconds > 0) {
		fadeTo(main, 0, seconds);
		fadeTimer = setTimeout(endCrossfade, seconds * 1000 + 300);
	} else endCrossfade();
	// (it began playing before it was the one: what a song does when it starts playing)
	playing.set(!incoming.paused);
	setupMediaSession();
	updatePosition();
	log(`playing ${song.title}`);
	save();
	topUp();
	readNext();
}

// --- The next song, ahead of time -------------------------------------------------------------
// With the screen locked, iOS lets a page that plays go on, and an element take over from one
// that plays; what it doesn't do reliably is start a song after a moment in which nothing
// played (a new song in the same element: the old one stops, the new one has to come from the
// network first). So a few seconds before a song ends, the next one is started in the spare
// element, silent (its sound goes through Web Audio), and stopped again once it plays: loaded.
// At the song's end it starts at once and is the one, while the old one still played. Only
// when the songs' sound goes through Web Audio (else the next song as before: in the same
// element), and not with a crossfade (which takes the next song the same way, earlier).

/** This long (s) before a song's end the next one is made ready */
const PREPARE = 12;
/** The next song, loading or loaded, in the spare element */
let prepared: {
	key: string;
	song: MapSet;
	url: string;
	element: HTMLAudioElement;
	loaded: boolean;
	started: Promise<void>;
} | null = null;
/** A song that couldn't be made ready (not tried again: it starts at the end, as before) */
let notPrepared: string | null = null;
/** The song at its end hands over to the one made ready (until that one plays) */
let handing: { stop: () => void } | null = null;

function prepareIfDue(now: number, duration: number) {
	if (crossfadeSeconds() > 0 || handing || crossfading) return;
	if (!duration || now < duration - PREPARE) return;
	const main = audio!;
	if (!isRouted(main) || !spare || !isRouted(spare) || !graphRunning()) return;
	const sleep = get(sleepTimer);
	if (get(repeat) === 'one' || (sleep && 'endOfSong' in sleep)) return;
	const at = upcomingIndex();
	const song = at == null ? null : get(queue).songs[at];
	const key = song ? keyOf(song) : null;
	// (another song comes next now: put in the queue meanwhile, or the queue was reordered)
	if (prepared && prepared.key !== key) dropPrepared();
	if (!song || !key || prepared || notPrepared === key) return;
	// (a downloaded song is read from the phone first: at one of the next time updates)
	const url =
		readAhead?.key === key ? readAhead.url : get(downloaded).has(key) ? null : streamUrl(song);
	if (!url) {
		readNext();
		return;
	}
	if (readAhead?.key === key) readAhead = null;
	const incoming = spare;
	fadeTo(incoming, 0, 0);
	incoming.src = url;
	// (at the speed of the mod)
	applyMod(incoming);
	log(`next song made ready: ${song.title}`);
	const mine: NonNullable<typeof prepared> = {
		key,
		song,
		url,
		element: incoming,
		loaded: false,
		started: incoming.play()
	};
	prepared = mine;
	mine.started.then(
		() => {
			// (taking over already, or not wanted any more)
			if (prepared !== mine) return;
			incoming.pause();
			incoming.currentTime = 0;
			mine.loaded = true;
			// (it began playing last: the lock screen's controls back to the song)
			reclaimNowPlaying();
		},
		(error) => {
			if (prepared !== mine) return;
			log(`next song not made ready (${error?.name}): it starts at the end`);
			notPrepared = key;
			dropPrepared();
		}
	);
}

/** Lets go of the song made ready (another one comes next) */
function dropPrepared() {
	const gone = prepared;
	prepared = null;
	if (gone) release(gone.element, gone.key, gone.url);
}

/** The spare element empty again; a downloaded song's audio stays read ahead */
function release(element: HTMLAudioElement, key: string, url: string) {
	element.pause();
	element.removeAttribute('src');
	element.load();
	unfade(element);
	if (!url.startsWith('blob:')) return;
	if (!readAhead) readAhead = { key, url };
	else if (readAhead.url !== url) URL.revokeObjectURL(url);
}

/**
 * At a song's end: the one made ready starts and is the one. False: none is (the next song
 * starts in this element then, as before)
 */
function handOver() {
	const ready = prepared;
	if (!ready || crossfading) return false;
	const at = upcomingIndex();
	const main = audio;
	if (
		at == null ||
		keyOf(get(queue).songs[at]) !== ready.key ||
		!main ||
		!isRouted(main) ||
		!isRouted(ready.element) ||
		!graphRunning()
	) {
		dropPrepared();
		return false;
	}
	prepared = null;
	const incoming = ready.element;
	const was = current();
	// (the song at its end goes quiet and plays on, round to its start, until the next sounds)
	fadeTo(main, 0, 0.02);
	log(`on to ${ready.song.title}${ready.loaded ? '' : ' (still loading)'}`);
	let over = false;
	// (another song chosen meanwhile: the one made ready stops, else it would play on silently
	// and take the lock screen's controls once it starts)
	const mine = (handing = {
		stop: () => {
			if (over) return;
			over = true;
			clearTimeout(late);
			release(incoming, ready.key, ready.url);
		}
	});
	/** Not this way: the next song in this element, as before */
	const instead = (why: string) => {
		clearTimeout(late);
		if (over) return;
		over = true;
		if (handing === mine) handing = null;
		log(`the song made ready didn't start (${why}): in this element`);
		release(incoming, ready.key, ready.url);
		notPrepared = ready.key;
		if (audio === main && current() === was) next();
	};
	const late = setTimeout(() => instead('took too long'), 8000);
	(ready.loaded ? incoming.play() : ready.started).then(
		() => {
			clearTimeout(late);
			// (another song was chosen meanwhile: that one plays)
			if (over) return;
			if (handing !== mine || audio !== main || current() !== was) {
				over = true;
				release(incoming, ready.key, ready.url);
				return;
			}
			over = true;
			handing = null;
			const paused = main.paused;
			takeOver(incoming, main, at, ready.song, ready.url, 0);
			// (paused in that moment: the next song, paused at its start)
			if (paused) pauseHere("paused at the song's end");
		},
		(error) => instead(error?.name ?? 'error')
	);
	return true;
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null;
let outgoingUrl: string | null = null;
/** The song gone out of a crossfade stops (at its end, or a pause or another song now) */
function endCrossfade() {
	if (fadeTimer) clearTimeout(fadeTimer);
	fadeTimer = null;
	const gone = outgoing;
	outgoing = null;
	if (!gone) return;
	gone.pause();
	gone.removeAttribute('src');
	gone.load();
	unfade(gone);
	if (outgoingUrl && outgoingUrl !== objectUrl) URL.revokeObjectURL(outgoingUrl);
	outgoingUrl = null;
}

/** Plays `songs` from the one at `index` (shuffled when shuffle is on) */
export function play(
	songs: MapSet[],
	index = 0,
	{ shuffled: shuffleThem = false, at = 0 }: { shuffled?: boolean; at?: number } = {}
) {
	if (!songs.length) return;
	wakeIfShown();
	if (shuffleThem) shuffle.set(true);
	ordered = songs.map(slim);
	const first = ordered[index] ?? ordered[0];
	if (get(shuffle)) {
		const order = shuffleThem
			? shuffled(ordered)
			: [first, ...shuffled(ordered.filter((_, i) => i !== index))];
		queue.set({ songs: order, index: 0 });
	} else {
		queue.set({ songs: ordered, index });
	}
	return load(at);
}

export function toggle() {
	const player = element();
	wakeIfShown();
	// After a start: the song of before, where it was
	if (!loaded) return load(get(time).current);
	if (player.paused) player.play().catch(startTurnedDown);
	else pauseHere('tapped');
}

/** A song ended by itself: the next one (repeat one: it plays on, as it loops) */
function songEnded() {
	// (the next song is on its way: the one at its end plays on quietly until then)
	if (handing) return;
	if (get(sleepTimer) && 'endOfSong' in get(sleepTimer)!) {
		sleepTimer.set(null);
		pauseHere('sleep timer, at the end of the song');
		jumped(0);
		element().currentTime = 0;
		return;
	}
	if (get(repeat) === 'one') return;
	const { songs, index } = get(queue);
	// The last one (offline: the last downloaded one): stop at its start
	const after = playableAfter(songs, index);
	if ((after < 0 || after >= songs.length) && get(repeat) !== 'all') {
		pauseHere('end of the queue');
		jumped(0);
		element().currentTime = 0;
		return;
	}
	if (!handOver()) next();
}

/** Offline, only the downloaded songs play: the next one of those (-1: none) */
function playableAfter(songs: MapSet[], index: number, step = 1) {
	if (!get(offline)) return index + step;
	const kept = get(downloaded);
	for (let i = index + step; i >= 0 && i < songs.length; i += step)
		if (kept.has(keyOf(songs[i]))) return i;
	return -1;
}

export function next() {
	wakeIfShown();
	const { songs } = get(queue);
	let { index } = get(queue);
	// (offline: past the ones that aren't downloaded)
	if (get(offline)) {
		const at = playableAfter(songs, index);
		if (at < 0) {
			if (get(repeat) !== 'all') return;
			const first = playableAfter(songs, -1);
			if (first < 0) return;
			queue.set({ songs, index: first });
			load();
			return;
		}
		index = at - 1;
	}
	if (index + 1 >= songs.length) {
		if (get(repeat) !== 'all' || !songs.length) return;
		queue.set({ songs, index: 0 });
	} else queue.set({ songs, index: index + 1 });
	load();
}

export function previous() {
	wakeIfShown();
	const { songs, index } = get(queue);
	// A bit into the song: back to its start, else the one before
	if (element().currentTime > 3 || (index === 0 && get(repeat) !== 'all')) {
		seekedByHand = true;
		jumped(0);
		element().currentTime = 0;
		return;
	}
	let before = index === 0 ? songs.length - 1 : index - 1;
	if (get(offline)) {
		before = playableAfter(songs, index, -1);
		if (before < 0) {
			seekedByHand = true;
			jumped(0);
			element().currentTime = 0;
			return;
		}
	}
	queue.set({ songs, index: before });
	load();
}

export function seek(seconds: number) {
	// (only a jump to the start isn't the song's end: dragged to the very end, the song going
	// round right after is its end)
	seekedByHand = seconds < 2;
	const player = element();
	// Not in the audio yet (after a start): the position for the first play
	if (!loaded) {
		time.update((t) => ({ ...t, current: Math.max(0, Math.min(seconds, t.duration || seconds)) }));
		save();
		return;
	}
	// Dragged to the very end: that's the song's end (it loops, so it would start over at once,
	// before its end could be seen)
	const duration = lengthOf(player);
	if (duration && seconds >= duration - 0.5) {
		log('dragged to the end');
		songEnded();
		return;
	}
	jumped(seconds);
	player.currentTime = seconds;
	updatePosition();
}

/** Plays the song at `index` of the queue */
export function jumpTo(index: number) {
	wakeIfShown();
	queue.update((q) => ({ ...q, index }));
	return load();
}

// Songs put in the queue by hand play before the playlist goes on (as in Spotify): right
// after the song playing, in the order they were added. They're marked, so the next one added
// comes after them, and so they aren't taken for songs of the playlist (the order to go back
// to when shuffle is turned off doesn't have them).

type Queued = MapSet & { queued?: boolean };
const isQueued = (song: MapSet | undefined) => !!(song as Queued | undefined)?.queued;
const asQueued = (song: MapSet) => ({ ...slim(song), queued: true }) as MapSet;
/** The last song of the playlist that played (where it goes on after the queued ones) */
let lastOfPlaylist: MapSet | null = null;
queue.subscribe(({ songs, index }) => {
	if (songs[index] && !isQueued(songs[index])) lastOfPlaylist = songs[index];
});

/** The song comes right after the one playing */
export function playNext(song: MapSet) {
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => ({
		songs: [...songs.slice(0, index + 1), asQueued(song), ...songs.slice(index + 1)],
		index
	}));
	save();
	readNext();
}

/** The song comes after the one playing and the songs already put in the queue, before the
 * playlist goes on */
export function addToQueue(song: MapSet) {
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => {
		let at = index + 1;
		while (isQueued(songs[at])) at++;
		return { songs: [...songs.slice(0, at), asQueued(song), ...songs.slice(at)], index };
	});
	save();
	readNext();
}

/** A song coming up moves to another place among those coming up */
export function moveInQueue(from: number, to: number) {
	const { index, songs } = get(queue);
	if (from <= index || to <= index || from >= songs.length || to >= songs.length || from === to)
		return;
	queue.update(({ songs, index }) => {
		const next = [...songs];
		const [song] = next.splice(from, 1);
		next.splice(to, 0, song);
		return { songs: next, index };
	});
	save();
	readNext();
}

export function removeFromQueue(at: number) {
	// (nor in the order to go back to when shuffle is turned off)
	const gone = get(queue).songs[at];
	// (a song put in the queue by hand isn't in it: the playlist's own copy of it stays)
	if (gone && !isQueued(gone) && get(shuffle)) {
		const key = keyOf(gone);
		const kept = ordered.findIndex((song) => keyOf(song) === key);
		if (kept >= 0) ordered = ordered.filter((_, i) => i !== kept);
	}
	queue.update(({ songs, index }) => ({
		songs: songs.filter((_, i) => i !== at),
		index: at < index ? index - 1 : index
	}));
	save();
	readNext();
}

export function toggleShuffle() {
	const on = !get(shuffle);
	shuffle.set(on);
	const song = current();
	if (!song) return;
	const { songs, index } = get(queue);
	// (the songs put in the queue by hand stay next, in their order, either way)
	const waiting = songs.slice(index + 1).filter(isQueued);
	const same = (a: MapSet, b: MapSet) => a.id == b.id && a.beatmaps?.[0]?.id == b.beatmaps?.[0]?.id;
	if (on) {
		ordered = songs.filter((other) => !isQueued(other));
		const rest = songs.filter((other, i) => i !== index && !isQueued(other));
		queue.set({ songs: [song, ...waiting, ...shuffled(rest)], index: 0 });
	} else {
		const back = (ordered.length ? ordered : songs).filter((other) => !isQueued(other));
		// Where the playlist goes on: after the song playing, or (it was put in the queue by
		// hand) after the last song of the playlist that played
		const from = isQueued(song) ? lastOfPlaylist : song;
		const at = from ? back.findIndex((other) => same(other, from!)) : -1;
		const before = back.slice(0, at + 1);
		const playing = isQueued(song) ? [song] : [];
		queue.set({
			songs: [...before, ...playing, ...waiting, ...back.slice(at + 1)],
			index: Math.max(before.length + playing.length - 1, 0)
		});
	}
	save();
	readNext();
}

export function toggleAutoplay() {
	autoplay.update((on) => !on);
	save();
	topUp();
}

export function cycleRepeat() {
	repeat.update((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
	save();
	readNext();
}

// The lock screen's controls: iOS gives them to whatever began playing last. An audio context
// started after the song (the songs' sound through Web Audio, the hitsounds, the Nightcore
// beat) took them, and for one of those iOS has no position to drag. So the song begins
// playing again (it plays on: only the order changes) whenever one starts.
export function reclaimNowPlaying() {
	if (audio && !audio.paused && audio.src)
		audio.play().catch((error) => log(`play() turned down: ${error?.name}`));
}
if (typeof window !== 'undefined') whenRunning(() => setTimeout(reclaimNowPlaying, 50));

// A song the phone didn't let start with the screen locked starts when the app is shown again
if (typeof document !== 'undefined')
	document.addEventListener('visibilitychange', () => {
		if (document.hidden || !turnedDown) return;
		turnedDown = false;
		if (!audio || !loaded || !audio.paused || !audio.src) return;
		log('the song that was turned down starts now');
		audio.play().catch((error) => log(`play() turned down: ${error?.name}`));
	});

// The loudness setting (the account's) applies at once
if (typeof window !== 'undefined') userSettings.subscribe(() => applyNormalize());

// Kept for the next start

const KEY = 'stosufy-web-player';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const saveSoon = () => (saveTimer ??= setTimeout(save, 5000));

function save() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = null;
	const { songs, index } = get(queue);
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				songs,
				index,
				ordered,
				// (before the first play the song isn't in the audio yet: where it was kept)
				at: loaded && audio ? audio.currentTime : get(time).current,
				duration: (loaded && audio && lengthOf(audio)) || get(time).duration,
				shuffle: get(shuffle),
				repeat: get(repeat),
				autoplay: get(autoplay),
				// (to tell at the next start whether the app was closed while a song played)
				playing: get(playing)
			})
		);
	} catch {
		// (full or private browsing: it starts empty next time)
	}
}

if (typeof localStorage !== 'undefined') {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (saved?.songs?.length) {
			queue.set({ songs: saved.songs, index: saved.index ?? 0 });
			ordered = saved.ordered ?? saved.songs;
			// Where it was, on a line of the right length right away (not only once it plays)
			const song = saved.songs[saved.index ?? 0];
			time.set({
				current: saved.at ?? 0,
				duration: saved.duration || Number(song?.beatmaps?.[0]?.total_length) || 0
			});
		}
		shuffle.set(!!saved?.shuffle);
		if (saved?.repeat) repeat.set(saved.repeat);
		if (saved?.autoplay === false) autoplay.set(false);
		log(
			saved?.playing
				? `app opened again: it was closed while ${saved.songs?.[saved.index]?.title ?? 'a song'} played (iOS closes apps in the background when it needs memory)`
				: `app opened (${__WEB_VERSION__})`
		);
	} catch {
		// (nothing to go on with)
	}
}

// A stream that stands still while it should play (the connection, without an error): on
// again from where it is, after a while
if (typeof window !== 'undefined') {
	let still = 0;
	let last = -1;
	setInterval(() => {
		const song = current();
		if (!audio || audio.paused || !song) {
			still = 0;
			return;
		}
		still = audio.currentTime === last ? still + 1 : 0;
		last = audio.currentTime;
		// (standing at its very end: that's its end, as Safari may think it longer than it is.
		// Also in the background and for downloaded songs: the queue would stand still there)
		const length = lengthOf(audio);
		if (still >= 2 && length && audio.currentTime >= length - 1.5) {
			still = 0;
			log('stood still at its end: its end');
			songEnded();
			return;
		}
		if (document.hidden || audio.src.startsWith('blob:')) return;
		if (still < 4 || !navigator.onLine || retries >= 4) return;
		still = 0;
		retries++;
		const at = audio.currentTime;
		log(`stream stood still at ${Math.round(at)}s: again, try ${retries}`);
		audio.src = get(previewOnly) ? previewUrl(song) : streamUrl(song);
		startAt(audio, at, song);
		audio.play().catch(startTurnedDown);
	}, 3000);
}

// The lock screen and Control Center

function setupMediaSession() {
	if (!('mediaSession' in navigator)) return;
	const session = navigator.mediaSession;
	// (as the play button: after a start, the song of before where it was)
	session.setActionHandler('play', () => {
		if (!loaded) load(get(time).current);
		else element().play().catch(startTurnedDown);
	});
	session.setActionHandler('pause', () => pauseHere('lock screen'));
	session.setActionHandler('nexttrack', () => {
		log('lock screen: next');
		next();
	});
	session.setActionHandler('previoustrack', () => {
		log('lock screen: back');
		previous();
	});
	// (with these, iOS shows ±10 s on the lock screen instead of back and next)
	for (const action of ['seekbackward', 'seekforward'] as const) {
		try {
			session.setActionHandler(action, null);
		} catch {
			// (not known here)
		}
	}
	session.setActionHandler(
		'seekto',
		(details) => details.seekTime != null && seek(details.seekTime)
	);
}

function updatePosition() {
	const duration = audio ? lengthOf(audio) : 0;
	if (!audio || !('mediaSession' in navigator) || !duration) return;
	try {
		navigator.mediaSession.setPositionState({
			duration,
			position: Math.min(audio.currentTime, duration),
			playbackRate: audio.playbackRate || 1
		});
	} catch {
		// (older Safari)
	}
}

function showInMediaSession(song: MapSet) {
	if (!('mediaSession' in navigator)) return;
	const show = (artwork: MediaImage[]) =>
		(navigator.mediaSession.metadata = new MediaMetadata({
			title: song.title ?? '',
			artist: song.artist ?? '',
			artwork
		}));
	show([{ src: coverUrl(song), sizes: '300x300', type: 'image/jpeg' }]);
	// Then the sharp one, if it's still this song (made ahead for the next one: right away then)
	sharpArtwork(song).then((artwork) => artwork && current() === song && show(artwork));
	const { songs, index } = get(queue);
	if (songs[index + 1]) sharpArtwork(songs[index + 1]);
}
