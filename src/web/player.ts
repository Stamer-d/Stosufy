// The web app's player: an <audio> element (iOS keeps that playing in the background and on
// the lock screen, where its controls come from the Media Session), its sound through Web
// Audio once that runs (audioGraph.ts: every song at the same loudness, crossfades; a second
// element takes the next song for a crossfade).
// With the screen locked a page may go on playing, but hardly start to: so the next song is
// made ready in the second element while this one still plays, and takes over at its end
// without a moment of silence in between (see "The next song, ahead of time").
// The songs come from the beatmap mirror, like the desktop app's streaming, or from the phone
// if they were downloaded. A song tapped starts straight from the mirror, right away; the
// next one is read whole into memory while this one plays (songAudio.ts), and so is the one
// playing a few seconds in: from memory a song can be jumped in anywhere (the mirror sends no
// byte ranges), its length is known, and it starts at once with the screen locked. The
// queue, shuffle and repeat are kept for the next start, where it goes on where it was.

import { get, writable } from 'svelte/store';
import { downloaded } from './downloads';
import { hold, heldUrl, isReading, cantPlayHeld, setKeeper } from './songAudio';
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

/** Songs like these from all of osu!, without those (set by listening.ts): for when the
 * user's own songs have too few like them (a new account, a song unlike the rest) */
let similarOnOsu: ((seeds: MapSet[], exclude: MapSet[]) => Promise<MapSet[]>) | null = null;
export function setSimilarOnOsu(find: typeof similarOnOsu) {
	similarOnOsu = find;
}
/** With fewer songs like these among the user's own, osu! is asked for more */
const FEW = 5;

/**
 * Autoplay: with fewer than two songs left, songs like the last ones are added, ahead of
 * time (with the screen locked, the next song has to be there already when one ends)
 */
function topUp() {
	if (elsewhere) return;
	const { songs, index } = get(queue);
	if (!get(autoplay) || get(repeat) !== 'off' || songs.length - index - 1 >= 2) return;
	const more = similarTo ? similarTo(songs.slice(-5).reverse(), songs).slice(0, 20).map(slim) : [];
	if (more.length) {
		log(`autoplay: ${more.length} songs like these`);
		queue.update((q) => ({ ...q, songs: [...q.songs, ...more] }));
		ordered.push(...more);
		save();
		holdNext();
	}
	if (more.length < FEW) topUpFromOsu();
}

let askingOsu = false;
/** Autoplay's songs from osu!, a moment later (it's asked): added if they're still wanted */
async function topUpFromOsu() {
	if (!similarOnOsu || askingOsu || get(offline)) return;
	askingOsu = true;
	try {
		const before = get(queue).songs;
		const found = await similarOnOsu(before.slice(-2).reverse(), before);
		const { songs, index } = get(queue);
		if (elsewhere || !get(autoplay) || get(repeat) !== 'off' || songs.length - index - 1 >= FEW)
			return;
		const have = new Set(songs.map((song) => String(song.id)));
		const more = found
			.filter((song) => !have.has(String(song.id)))
			.slice(0, 15)
			.map(slim);
		if (!more.length) return;
		log(`autoplay: ${more.length} songs like these from osu!`);
		queue.update((q) => ({ ...q, songs: [...q.songs, ...more] }));
		ordered.push(...more);
		save();
		holdNext();
	} catch {
		// (the queue ends where it ends)
	} finally {
		askingOsu = false;
	}
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
/** The song playing was asked for whole, into memory (once it played a few seconds) */
let askedWhole = false;
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
/** The element said it's done jumping (it may still tell its old place a moment after) */
let jumpDone = false;
function jumped(seconds: number) {
	lastTime = seconds;
	jumpingTo = seconds;
	jumpedAt = performance.now();
	jumpDone = false;
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
		// (there only once the element is done jumping and tells a place near where it was sent:
		// while it jumps, Safari tells where it's going, then its old place until it's there.
		// Taken for there too early, a jump ahead looked like the song going round: its end)
		const there = jumpDone && !player.seeking && Math.abs(now - jumpingTo) <= 2;
		if (!there && performance.now() - jumpedAt < 6000) return false;
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
		if (!elsewhere) playing.set(true);
		turnedDown = false;
		keepRunning();
		holdAudio(true);
	});
	player.addEventListener('pause', () => {
		if (!mine()) return;
		if (!elsewhere) playing.set(false);
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
		if (!mine() || elsewhere) return;
		const now = player.currentTime;
		const duration = lengthOf(player);
		// (a jump that waits for the song to be in memory: the line stays where it goes)
		time.set({ current: waitingJump?.song === loaded ? waitingJump!.at : now, duration });
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
			holdWhole(player, now);
			holdNext();
		}
		seekedByHand = false;
		saveSoon();
	});
	// (going round is a jump to the start: seen here right away, the time updates may come
	// late with the screen locked)
	player.addEventListener('seeked', () => {
		if (mine()) jumpDone = true;
	});
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
		if (!mine() || !song) return;
		const code = player.error?.code;
		const at = lastTime;
		// From memory, and the browser can't play it (its format, mostly): straight from the
		// mirror instead, as before songs were kept in memory
		if (player.src.startsWith('blob:')) {
			log(`can't play ${song.title} from memory (error ${code}): from the mirror`);
			cantPlayHeld(song);
			player.src = streamUrl(song);
			startAt(player, at > 1 ? at : 0, song);
			player.play().catch(startTurnedDown);
			return;
		}
		// It played and the stream broke off (the connection, a moment): on from where it was,
		// a few times, waiting a bit longer each time
		if (!get(previewOnly) && at > 1 && retries < 4) {
			retries++;
			log(`stream broke off at ${Math.round(at)}s (error ${code}): again, try ${retries}`);
			setTimeout(() => current() === song && mine() && playAgain(player, song, at), 1000 * retries);
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

/** The element plays the song straight from the mirror (not from memory, not its preview) */
const fromMirror = (player: HTMLAudioElement) => !!loaded && player.src === streamUrl(loaded);

/**
 * Plays the queue's current song: right away (from memory, or straight from the mirror),
 * only a downloaded one that isn't in memory waits for the phone to read it
 */
function load(at = 0) {
	const song = current();
	if (!song) return;
	const player = element();
	endCrossfade();
	// (a song made ready for after this one isn't the one now)
	handing?.stop();
	handing = null;
	dropPrepared();
	stopJump();
	loaded = song;
	previewOnly.set(false);
	showInMediaSession(song);
	const key = keyOf(song);
	const start = (url: string, how: string) => {
		crossfading = false;
		askedWhole = false;
		unfade(player);
		startLoudness(player, key);
		askDuration(song);
		// (the line at the new song's start right away, at its length as far as it's known:
		// not the song before's place for a moment, then a length that jumps)
		time.set({ current: at, duration: songDuration(song, Number.NaN) });
		player.src = url;
		startAt(player, at, song);
		const format = formatOf(song);
		log(`start ${song.title} (${how}${format ? `, ${format}` : ''})`);
		player.play().catch(startTurnedDown);
		save();
		topUp();
		holdNext();
	};
	const local = get(downloaded).has(key);
	const url = heldUrl(song);
	if (url) start(url, local ? 'downloaded' : 'from memory');
	else if (local)
		return hold(song, true).then((url) => {
			if (current() === song) start(url ?? streamUrl(song), url ? 'downloaded' : 'stream');
		});
	else start(streamUrl(song), 'stream');
}

/** This long (s) into a song the next one is read into memory, and the one playing if it
 * plays straight from the mirror (not each song skipped past: the mirror counts) */
const AHEAD_AFTER = 5;

/** Reads the next song into memory ahead of time */
function holdNext() {
	if (elsewhere) return;
	const at = upcomingIndex();
	const upcoming = at == null ? null : get(queue).songs[at];
	if (!upcoming) return;
	// (one from the mirror only once this song plays a while; a downloaded one right away)
	if (
		!get(downloaded).has(keyOf(upcoming)) &&
		(!audio || audio.paused || audio.currentTime < AHEAD_AFTER)
	)
		return;
	hold(upcoming);
}

/** The song playing straight from the mirror is read into memory too, a few seconds in: to
 * jump in it, and to go on if its stream breaks off */
function holdWhole(player: HTMLAudioElement, now: number) {
	if (askedWhole || now < AHEAD_AFTER || !loaded || !fromMirror(player)) return;
	askedWhole = true;
	// (not where data is saved: it would come from the mirror twice)
	const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
		?.saveData;
	if (!saving) hold(loaded);
}

/** The song goes on from memory at `at` (s), in the element it plays in */
function playFromMemory(player: HTMLAudioElement, song: MapSet, url: string, at: number) {
	const playing = !player.paused;
	player.src = url;
	startAt(player, at, song);
	if (playing) player.play().catch(startTurnedDown);
	updatePosition();
}

/** The song again from `at` (its stream broke off or stood still): from memory if it's
 * there, else from the mirror once more */
function playAgain(player: HTMLAudioElement, song: MapSet, at: number) {
	const url = get(previewOnly) ? previewUrl(song) : (heldUrl(song) ?? streamUrl(song));
	player.src = url;
	startAt(player, at, song);
	player.play().catch(startTurnedDown);
	// (the mirror can't be asked for a part: if the song doesn't get there, from memory)
	if (url === streamUrl(song)) checkJump(song, at);
}

// --- Jumping in a song --------------------------------------------------------------------
// A song in memory (or downloaded, or a preview) goes anywhere at once. One that plays
// straight from the mirror only goes where it has come in already: the mirror sends it in one
// piece. So from memory if it's there; else the element is asked, and looked at a moment
// later: if it isn't there, the song is read into memory and goes on from there.

/** A jump that waits for the song to be in memory: where to, in which song */
let waitingJump: { song: MapSet; at: number } | null = null;
let jumpCheck: ReturnType<typeof setTimeout> | null = null;

/** No jump is waited for or looked after any more (another song, another jump) */
function stopJump() {
	waitingJump = null;
	if (jumpCheck) clearTimeout(jumpCheck);
	jumpCheck = null;
}

const covers = (ranges: TimeRanges, seconds: number) => {
	for (let i = 0; i < ranges.length; i++)
		if (ranges.start(i) <= seconds && seconds <= ranges.end(i) - 0.5) return true;
	return false;
};

/** The song playing goes to `seconds` */
function jumpWithin(player: HTMLAudioElement, seconds: number) {
	const song = loaded;
	stopJump();
	jumped(seconds);
	if (!song || !fromMirror(player)) {
		player.currentTime = seconds;
		return;
	}
	const url = heldUrl(song);
	if (url) {
		log(`jump to ${Math.round(seconds)}s: from memory`);
		playFromMemory(player, song, url, seconds);
		return;
	}
	if (covers(player.buffered, seconds) || covers(player.seekable, seconds)) {
		player.currentTime = seconds;
		checkJump(song, seconds);
		return;
	}
	// (not come in that far yet: the song plays on where it is until it's in memory)
	log(`jump to ${Math.round(seconds)}s: once the song is in memory`);
	jumpFromMemory(song, seconds);
}

/** Looks whether the song got to `seconds`; if not, it goes there from memory */
function checkJump(song: MapSet, seconds: number) {
	if (jumpCheck) clearTimeout(jumpCheck);
	const from = performance.now();
	jumpCheck = setTimeout(() => {
		jumpCheck = null;
		const player = audio;
		if (!player || loaded !== song || !fromMirror(player)) return;
		const passed = ((performance.now() - from) / 1000) * (player.playbackRate || 1);
		const now = player.currentTime;
		if (!player.seeking && now > seconds - 2.5 && now < seconds + passed + 2.5) return;
		log(`the stream didn't get to ${Math.round(seconds)}s: from memory`);
		jumpFromMemory(song, seconds);
	}, 1500);
}

function jumpFromMemory(song: MapSet, seconds: number) {
	const mine = (waitingJump = { song, at: seconds });
	hold(song, true).then((url) => {
		if (waitingJump !== mine) return;
		waitingJump = null;
		const player = audio;
		if (!url || !player || loaded !== song || !fromMirror(player)) return;
		jumped(seconds);
		playFromMemory(player, song, url, seconds);
	});
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
	// (a downloaded song not in memory would wait for the phone: as without crossfade then)
	const url = heldUrl(song) ?? (get(downloaded).has(key) ? null : streamUrl(song));
	if (!url) {
		hold(song, true);
		return;
	}
	crossfading = true;
	const incoming = spare;
	const was = current();
	fadeTo(incoming, 0, 0);
	incoming.src = url;
	// (at the speed of the mod: the beat goes on)
	applyMod(incoming);
	log(`crossfade into ${song.title} (${seconds}s)`);
	incoming.play().then(
		() => {
			// (another song meanwhile, or paused: not this one then)
			if (audio !== main || main.paused || current() !== was) {
				release(incoming);
				return;
			}
			takeOver(incoming, main, at, song, seconds);
		},
		(error) => {
			// (turned down: iOS, with the screen locked. The next song when this one ends then)
			log(`crossfade turned down (${error?.name}): the next song at the end`);
			release(incoming);
		}
	);
}

/** The song in the other element is the one now: `seconds` of both together (0: at once) */
function takeOver(
	incoming: HTMLAudioElement,
	main: HTMLAudioElement,
	at: number,
	song: MapSet,
	seconds: number
) {
	// (a song still going out of a crossfade before stops now)
	endCrossfade();
	outgoing = main;
	spare = main;
	audio = incoming;
	stopJump();
	askedWhole = false;
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
	holdNext();
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
	// (from memory; one on its way there is waited for a little: at one of the next time
	// updates. Else straight from the mirror, unless it's downloaded: read from the phone first)
	const url =
		heldUrl(song) ??
		(get(downloaded).has(key) || (isReading(song) && now < duration - PREPARE / 2)
			? null
			: streamUrl(song));
	if (!url) {
		hold(song, true);
		return;
	}
	const incoming = spare;
	fadeTo(incoming, 0, 0);
	incoming.src = url;
	// (at the speed of the mod)
	applyMod(incoming);
	log(`next song made ready: ${song.title}${url.startsWith('blob:') ? ' (from memory)' : ''}`);
	const mine: NonNullable<typeof prepared> = {
		key,
		song,
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
	if (gone) release(gone.element);
}

/** The spare element empty again */
function release(element: HTMLAudioElement) {
	element.pause();
	element.removeAttribute('src');
	element.load();
	unfade(element);
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
			release(incoming);
		}
	});
	/** Not this way: the next song in this element, as before */
	const instead = (why: string) => {
		clearTimeout(late);
		if (over) return;
		over = true;
		if (handing === mine) handing = null;
		log(`the song made ready didn't start (${why}): in this element`);
		release(incoming);
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
				release(incoming);
				return;
			}
			over = true;
			handing = null;
			const paused = main.paused;
			takeOver(incoming, main, at, ready.song, 0);
			// (paused in that moment: the next song, paused at its start)
			if (paused) pauseHere("paused at the song's end");
		},
		(error) => instead(error?.name ?? 'error')
	);
	return true;
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null;
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
}

/** Plays `songs` from the one at `index` (shuffled when shuffle is on) */
export function play(
	songs: MapSet[],
	index = 0,
	{ shuffled: shuffleThem = false, at = 0 }: { shuffled?: boolean; at?: number } = {}
) {
	if (!songs.length) return;
	if (elsewhere) {
		const from = shuffleThem ? shuffled(songs) : songs;
		return elsewhere.play(from, shuffleThem ? 0 : index);
	}
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
	if (elsewhere) return elsewhere.toggle();
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
	if (elsewhere) return elsewhere.next();
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
	if (elsewhere) return elsewhere.previous();
	wakeIfShown();
	const { songs, index } = get(queue);
	// A bit into the song: back to its start, else the one before
	if (element().currentTime > 3 || (index === 0 && get(repeat) !== 'all')) {
		seekedByHand = true;
		jumpWithin(element(), 0);
		return;
	}
	let before = index === 0 ? songs.length - 1 : index - 1;
	if (get(offline)) {
		before = playableAfter(songs, index, -1);
		if (before < 0) {
			seekedByHand = true;
			jumpWithin(element(), 0);
			return;
		}
	}
	queue.set({ songs, index: before });
	load();
}

export function seek(seconds: number) {
	if (elsewhere) {
		time.update((t) => ({ ...t, current: seconds }));
		return elsewhere.seek(seconds);
	}
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
	jumpWithin(player, seconds);
	updatePosition();
}

/** Plays the song at `index` of the queue */
export function jumpTo(index: number) {
	if (elsewhere) return elsewhere.jumpTo(index);
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

// The songs that stay in memory whatever else is read: the one playing, the next, the one
// before (going back is at once), and one made ready or going out in a crossfade
setKeeper(() => {
	const { songs, index } = get(queue);
	const next = upcomingIndex();
	return [
		loaded,
		songs[index],
		songs[index - 1],
		next == null ? null : songs[next],
		prepared?.song
	];
});

/** The song comes right after the one playing */
export function playNext(song: MapSet) {
	if (elsewhere) return elsewhere.queueSong(song, true);
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => ({
		songs: [...songs.slice(0, index + 1), asQueued(song), ...songs.slice(index + 1)],
		index
	}));
	save();
	holdNext();
}

/** The song comes after the one playing and the songs already put in the queue, before the
 * playlist goes on */
export function addToQueue(song: MapSet) {
	if (elsewhere) return elsewhere.queueSong(song, false);
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => {
		let at = index + 1;
		while (isQueued(songs[at])) at++;
		return { songs: [...songs.slice(0, at), asQueued(song), ...songs.slice(at)], index };
	});
	save();
	holdNext();
}

/** All of these come after the song playing and the songs already put in the queue (a whole
 * playlist), before the playlist that plays goes on */
export function addAllToQueue(list: MapSet[]) {
	if (!list.length) return;
	if (elsewhere) {
		for (const song of list) elsewhere.queueSong(song, false);
		return;
	}
	if (!current()) return play(list);
	queue.update(({ songs, index }) => {
		let at = index + 1;
		while (isQueued(songs[at])) at++;
		return { songs: [...songs.slice(0, at), ...list.map(asQueued), ...songs.slice(at)], index };
	});
	save();
	holdNext();
}

/** A song coming up moves to another place among those coming up */
export function moveInQueue(from: number, to: number) {
	if (elsewhere) return elsewhere.cantChangeQueue();
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
	holdNext();
}

export function removeFromQueue(at: number) {
	if (elsewhere) return elsewhere.cantChangeQueue();
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
	holdNext();
}

/** Takes out all that comes after the song playing (with autoplay, songs like it play on) */
export function clearQueue() {
	if (elsewhere) return elsewhere.cantChangeQueue();
	const { songs, index } = get(queue);
	if (index < 0 || songs.length <= index + 1) return;
	const kept = songs.slice(0, index + 1);
	queue.set({ songs: kept, index });
	ordered = kept.filter((song) => !isQueued(song));
	save();
	topUp();
	holdNext();
}

export function toggleShuffle() {
	if (elsewhere) return elsewhere.setShuffle(!get(shuffle));
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
	holdNext();
}

export function toggleAutoplay() {
	autoplay.update((on) => !on);
	save();
	topUp();
}

export function cycleRepeat() {
	if (elsewhere) return elsewhere.cycleRepeat();
	repeat.update((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
	save();
	holdNext();
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

// --- Another device plays (Stosufy Connect, see connect.ts) ---------------------------------
// The player shows what it plays (its song, queue, position, shuffle and repeat), and its
// controls and the songs chosen go there. What played here is put aside meanwhile, and comes
// back when this device plays its own again.

export interface Elsewhere {
	play(songs: MapSet[], index: number): void;
	toggle(): void;
	next(): void;
	previous(): void;
	seek(seconds: number): void;
	jumpTo(index: number): void;
	queueSong(song: MapSet, next: boolean): void;
	setShuffle(on: boolean): void;
	cycleRepeat(): void;
	cantChangeQueue(): void;
}

export interface Shown {
	songs: MapSet[];
	index: number;
	playing: boolean;
	current: number;
	duration: number;
	shuffle: boolean;
	repeat: Repeat;
}

/** The controls of the device that plays, while another one does */
let elsewhere: Elsewhere | null = null;
/** What this device played, put aside */
let ownBefore: (Omit<Shown, 'playing'> & { ordered: MapSet[]; autoplay: boolean }) | null = null;

/** Puts the queue, position, shuffle and repeat in place, to go on from there with play */
function showPaused(shown: Omit<Shown, 'playing'>, kept: MapSet[] = shown.songs) {
	queue.set({ songs: shown.songs, index: shown.index });
	ordered = kept;
	time.set({ current: shown.current, duration: shown.duration });
	shuffle.set(shown.shuffle);
	repeat.set(shown.repeat);
	playing.set(false);
}

/** Another device plays: the player shows it (called again whenever it changes there) */
export function showElsewhere(controls: Elsewhere, shown: Shown) {
	if (!elsewhere) {
		const player = audio;
		ownBefore = {
			...get(queue),
			ordered,
			current: loaded && player ? player.currentTime : get(time).current,
			duration: (loaded && player && lengthOf(player)) || get(time).duration,
			shuffle: get(shuffle),
			repeat: get(repeat),
			autoplay: get(autoplay)
		};
		save();
		if (player && !player.paused) pauseHere('another device plays');
		handing?.stop();
		handing = null;
		dropPrepared();
		stopJump();
		// (the song here starts again where it was, when it's this one's turn again)
		loaded = null;
		log('another device plays: showing it');
	}
	elsewhere = controls;
	const now = get(queue);
	if (now.songs !== shown.songs || now.index !== shown.index)
		queue.set({ songs: shown.songs, index: shown.index });
	if (get(playing) !== shown.playing) playing.set(shown.playing);
	time.set({ current: shown.current, duration: shown.duration });
	if (get(shuffle) !== shown.shuffle) shuffle.set(shown.shuffle);
	if (get(repeat) !== shown.repeat) repeat.set(shown.repeat);
}

/**
 * This device's own again: what it played before, or (`goOn`, the other device is gone) what
 * the other one played last, paused, to play on here
 */
export function showOwn(goOn: Omit<Shown, 'playing'> | null = null) {
	if (!elsewhere) return;
	elsewhere = null;
	const own = ownBefore;
	ownBefore = null;
	loaded = null;
	if (goOn) showPaused(goOn);
	else if (own) {
		showPaused(own, own.ordered);
		autoplay.set(own.autoplay);
	} else
		showPaused({ songs: [], index: -1, current: 0, duration: 0, shuffle: false, repeat: 'off' });
	log(goOn ? 'the other device is gone: its song here' : 'this device plays its own again');
	save();
}

/** The playback came over from another device: on here from `at` (playing or paused) */
export function playHere(
	songs: MapSet[],
	index: number,
	at: number,
	start: boolean,
	mode: Omit<Shown, 'songs' | 'index' | 'playing' | 'current'>
) {
	showOwn();
	// (the order there stays: not shuffled again)
	shuffle.set(false);
	if (start) play(songs.map(slim), index, { at });
	else
		showPaused({
			songs: songs.map(slim),
			index,
			current: at,
			duration: mode.duration,
			shuffle: false,
			repeat: mode.repeat
		});
	shuffle.set(mode.shuffle);
	repeat.set(mode.repeat);
	save();
}

/** What plays here (not what's shown from another device), for the other devices */
export function ownPlayback() {
	if (elsewhere) return null;
	const song = current();
	if (!song) return null;
	const player = loaded ? audio : null;
	return {
		song,
		position: player ? player.currentTime : get(time).current,
		duration: (player && lengthOf(player)) || get(time).duration || 0,
		playing: !!player && !player.paused,
		rate: player?.playbackRate || 1,
		shuffle: get(shuffle),
		repeat: get(repeat)
	};
}

/** Another device plays now: stopped here (it shows that one next) */
export function stopForElsewhere() {
	if (audio && !audio.paused) pauseHere('another device plays now');
}

// Kept for the next start

const KEY = 'stosufy-web-player';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const saveSoon = () => (saveTimer ??= setTimeout(save, 5000));

function save() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = null;
	// (what another device plays isn't this one's to go on with)
	if (elsewhere) return;
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
		playAgain(audio, song, at);
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
