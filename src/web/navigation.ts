// How the web app moves between pages, like an app on a phone:
// - each tab keeps where you were in it (tapping it again goes back to its start, and at
//   its start scrolls to the top)
// - a new page slides in a little (from the right, or the left going back); tabs fade
// - installed on the home screen, a swipe from the left edge goes back, the app's own (iOS'
//   showed a black page where the page before should be)

import { haptic } from './haptics';
import { log } from './log';
import { frameMeter, gestureNote as note } from './frameMeter';
import { writable, get } from 'svelte/store';
import { goto, onNavigate, afterNavigate, preloadCode } from '$app/navigation';

const base = __WEB_BASE__;

export const TABS = [
	{
		id: 'home',
		root: `${base}/`,
		label: 'Home',
		icon: 'icon-[mingcute--home-4-line]',
		activeIcon: 'icon-[mingcute--home-4-fill]'
	},
	{
		id: 'library',
		root: `${base}/library`,
		label: 'Library',
		icon: 'icon-[mingcute--playlist-2-line]',
		activeIcon: 'icon-[mingcute--playlist-2-fill]'
	},
	{
		id: 'search',
		root: `${base}/search`,
		label: 'Search',
		icon: 'icon-[mingcute--search-line]',
		activeIcon: 'icon-[mingcute--search-3-fill]'
	},
	{
		id: 'downloads',
		root: `${base}/downloads`,
		label: 'Downloads',
		icon: 'icon-[mingcute--download-2-line]',
		activeIcon: 'icon-[mingcute--download-2-fill]'
	}
] as const;
type TabId = (typeof TABS)[number]['id'];

const rootOf = (path: string) =>
	TABS.find((tab) => tab.root === path || (tab.id === 'home' && path === base))?.id ?? null;

/** The tab the page is in (a playlist is in the tab it was opened from) */
export const currentTab = writable<TabId>('home');
const lastPath: Partial<Record<TabId, string>> = {};
const scrollOf: Record<string, number> = {};

export function openTab(id: TabId) {
	haptic();
	const tab = TABS.find((t) => t.id === id)!;
	const here = location.pathname;
	if (get(currentTab) === id) {
		// Again: to its start, at its start to the top
		if (here !== tab.root) goto(tab.root);
		else window.scrollTo({ top: 0, behavior: 'smooth' });
		return;
	}
	scrollOf[here] = window.scrollY;
	currentTab.set(id);
	switchingTab = true;
	goto(lastPath[id] ?? tab.root, { reset: false }).then(() => {
		window.scrollTo({ top: scrollOf[location.pathname] ?? 0 });
	});
}

// --- Going back -------------------------------------------------------------------------
// Only to pages of this visit: going back past them would leave the app (iOS then loads it
// again: a black screen for seconds, and the song stops)

/** How many pages of this visit lie behind this one */
/** The pages of this visit, each with the tab it's in, and where in them this page is */
let stack: { path: string; tab: TabId }[] = [];
let depth = 0;
let replacing = false;

/** The page before, if it's of this visit and of the same tab (as an app's back goes) */
const sameTabBefore = () => depth > 0 && stack[depth - 1]?.tab === stack[depth]?.tab;

/** Back to the page before in this tab; if there's none, to `fallback` (in its place) */
export function goBack(fallback?: string) {
	if (sameTabBefore()) {
		ownBack = true;
		history.back();
		return;
	}
	replacing = true;
	const target = fallback ?? tabRoot();
	// (where it was scrolled to when it was left, as the picture of it shows)
	pendingScroll = snapshots.get(target)?.scroll ?? null;
	goto(target, { replaceState: true });
}

const tabRoot = () => TABS.find((tab) => tab.id === get(currentTab))!.root;

// --- iOS' own back swipe ---------------------------------------------------------------------
// Newer iOS has a back swipe of its own for apps on the home screen: it showed a black page
// where the page before should be, and went back along with the app's (the screen twice, two
// pages back). A touch at the edge is held from iOS, so the app's swipe is the only one. Should
// iOS go back anyway during a swipe, the app's swipe is called off (not a second page back).
// (It used to step aside for good after once seeing that: once was also a false alarm now and
// then, and then iOS' black swipe came back.)

/** The app went back itself (else it was iOS' swipe or the system) */
let ownBack = false;
/** Where back goes: the page before in this tab, else the tab's start */
const backTarget = () => (sameTabBefore() ? stack[depth - 1].path : tabRoot());
let pendingScroll: number | null = null;

/** Whether there's a page of this tab to go back to */
export const canGoBack = sameTabBefore;

/** How far from the left / right edge a touch is held from iOS' swipe */
const SIDE = 24;
const SIDE_RIGHT = 12;

const standalone = () =>
	matchMedia('(display-mode: standalone)').matches ||
	!!(navigator as Navigator & { standalone?: boolean }).standalone;

/** Set up in the layout: the slides between pages, and the tabs following the pages */
/** Every page's code, so going anywhere (back too) doesn't wait for it to load */
const PAGES = [
	'/',
	'/library',
	'/search',
	'/downloads',
	'/playlist/1',
	'/mix/x',
	'/smart/x',
	'/map/1',
	'/community',
	'/friends',
	'/wrapped',
	'/settings',
	'/library/downloads'
];

export function setupNavigation(page: () => HTMLElement | undefined) {
	// (once the app is up and idle)
	const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500));
	idle(() => {
		for (const path of PAGES)
			preloadCode((base + path) as Parameters<typeof preloadCode>[0]).catch(() => {});
	});

	afterNavigate((navigation) => {
		const path = navigation.to?.url.pathname;
		if (!path) return;
		const tabFor = () => rootOf(path) ?? get(currentTab);
		// (the pages of this visit: going back only to these, and in the same tab)
		if (navigation.type === 'enter' || !stack.length) {
			stack = [{ path, tab: tabFor() }];
			depth = 0;
		} else if (navigation.type === 'popstate') {
			const delta = (navigation as { delta?: number }).delta ?? -1;
			depth = Math.max(0, Math.min(stack.length - 1, depth + delta));
			if (stack[depth]?.path !== path) stack[depth] = { path, tab: tabFor() };
		} else if (replacing || navigation.from?.url.pathname === path) {
			stack[depth] = { path, tab: tabFor() };
		} else {
			stack = [...stack.slice(0, depth + 1), { path, tab: tabFor() }];
			depth = stack.length - 1;
		}
		replacing = false;
		const tab = stack[depth].tab;
		currentTab.set(tab);
		lastPath[tab] = path;
	});

	// Only the new page moves (sliding in, or fading for another tab): cheap for a phone, not
	// a picture of the whole page as the View Transitions API takes. Never through transparent:
	// that showed the empty background for a moment.
	let kind: 'forward' | 'back' | 'fade' | 'none' = 'none';
	onNavigate((navigation) => {
		const from = navigation.from?.url.pathname;
		const to = navigation.to?.url.pathname;
		if (!from || !to || from === to) return void (kind = 'none');
		// Going on to another page: a picture of this one kept, to show under the finger when
		// swiping back (as iOS shows the page before)
		if (navigation.type !== 'popstate' && !replacing) keepSnapshot(page(), from);
		const back =
			navigation.type === 'popstate'
				? ((navigation as { delta?: number }).delta ?? -1) < 0
				: !!rootOf(to) && !rootOf(from);
		const systemBack = navigation.type === 'popstate' && !ownBack;
		ownBack = false;
		kind =
			swipedBack || systemBack
				? 'none'
				: switchingTab || (rootOf(from) && rootOf(to))
					? 'fade'
					: back
						? 'back'
						: 'forward';
		swipedBack = false;
		switchingTab = false;
	});
	afterNavigate(() => {
		const element = page();
		if (element && resetAfterBack) {
			resetAfterBack = false;
			const shown = underlay;
			clearPage(element);
			if (pendingScroll != null) window.scrollTo(0, pendingScroll);
			pendingScroll = null;
			if (shown) {
				// The page before was under it already, where it is: it just stays
				requestAnimationFrame(() => requestAnimationFrame(() => removeUnderlay(shown)));
				return;
			}
			element.animate([{ transform: 'translate3d(-25%, 0, 0)' }, { transform: 'none' }], {
				duration: 240,
				easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
			});
			return;
		}
		if (!element || kind === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches)
			return;
		const frames: Keyframe[] =
			kind === 'fade'
				? [{ opacity: 0.6 }, { opacity: 1 }]
				: [
						{ transform: `translate3d(${kind === 'forward' ? 40 : -40}px, 0, 0)` },
						{ transform: 'none' }
					];
		element.animate(frames, {
			duration: kind === 'fade' ? 120 : 200,
			easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
		});
		kind = 'none';
	});

	// A touch at the side edges: iOS' swipe held off (it would go back or forward itself). A tap
	// there still taps (holding the touch from iOS holds its click too).
	let heldTap: { target: Element; x: number; y: number } | null = null;
	window.addEventListener(
		'touchstart',
		(event) => {
			heldTap = null;
			if (!standalone() || !event.cancelable || event.touches.length > 1) return;
			const touch = event.touches[0];
			if (touch.clientX > SIDE && touch.clientX < window.innerWidth - SIDE_RIGHT) return;
			const target = event.target as HTMLElement;
			if (target.closest?.('input, textarea, select, [contenteditable]')) return;
			event.preventDefault();
			heldTap = { target, x: touch.clientX, y: touch.clientY };
		},
		{ passive: false }
	);
	window.addEventListener(
		'touchmove',
		(event) => {
			const touch = event.touches[0];
			if (heldTap && Math.hypot(touch.clientX - heldTap.x, touch.clientY - heldTap.y) > 10)
				heldTap = null;
		},
		{ passive: true }
	);
	window.addEventListener('touchend', () => {
		if (!heldTap) return;
		const { target, x, y } = heldTap;
		heldTap = null;
		target.dispatchEvent(
			new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				view: window,
				clientX: x,
				clientY: y
			})
		);
	});

	// Swipe from the left edge: back. The page follows the finger with the page before under
	// it; let go far or fast enough and it slides away.
	let start: { x: number; y: number } | null = null;
	let dx = 0;
	let tracking = false;
	let samples: { x: number; t: number }[] = [];
	let meter: ReturnType<typeof frameMeter> | null = null;
	const EDGE = 28;
	window.addEventListener(
		'touchstart',
		(event) => {
			const touch = event.touches[0];
			if (!standalone() || touch.clientX > EDGE || rootOf(location.pathname)) return;
			// (what swipes across itself keeps its swipe; nothing while a sheet is open)
			if ((event.target as HTMLElement).closest?.('[data-no-edge], .fixed')) return;
			start = { x: touch.clientX, y: touch.clientY };
			dx = 0;
			tracking = false;
			samples = [{ x: touch.clientX, t: performance.now() }];
			// The page before put under this one already now, not at the first move: that work
			// (a page's worth) then isn't in the first frames of the swipe
			const element = page();
			if (element) showUnderlay(element);
		},
		{ passive: true }
	);
	window.addEventListener(
		'touchmove',
		(event) => {
			if (!start) return;
			const touch = event.touches[0];
			const x = touch.clientX - start.x;
			const y = touch.clientY - start.y;
			const element = page();
			if (!tracking) {
				// (up or down: not this, the page as it was)
				if (Math.abs(y) > Math.abs(x) && Math.abs(y) > 10) {
					start = null;
					undoSwipe();
					return;
				}
				if (x < 8) return;
				tracking = true;
				meter = frameMeter('swipe back', note);
			}
			const now = performance.now();
			samples.push({ x: touch.clientX, t: now });
			while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
			dx = Math.max(0, x);
			if (element) {
				element.style.transition = 'none';
				element.style.transform = `translate3d(${dx}px, 0, 0)`;
				moveUnderlay(dx / window.innerWidth, 'none');
			}
		},
		{ passive: true }
	);
	const end = () => {
		if (!start) return;
		start = null;
		const element = page();
		// (a tap at the edge, not a swipe: the page as it was)
		if (!tracking || !element) return void undoSwipe();
		meter?.release();
		meter = null;
		const first = samples[0];
		const last = samples[samples.length - 1];
		const speed = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
		const width = window.innerWidth;
		const back = speed > 0.35 || (dx > width * 0.35 && speed > -0.2);
		if (back) {
			haptic();
			// The rest of the way at the finger's speed; then the page before takes its place
			// (it's under it already, if a picture of it was kept)
			const duration = Math.max(140, Math.min(240, (width - dx) / Math.max(speed, 1.2)));
			const curve = `${duration}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
			element.style.transition = `transform ${curve}`;
			element.style.transform = `translate3d(${width}px, 0, 0)`;
			moveUnderlay(1, `transform ${curve}, opacity ${curve}`);
			swipedBack = true;
			resetAfterBack = true;
			// (with the page before under it, the swap waits until this one is gone: no jump)
			backTimer = setTimeout(
				() => {
					backTimer = null;
					goBack();
				},
				underlay ? duration : 0
			);
			// (if the page before doesn't come, this one doesn't stay away)
			setTimeout(() => {
				if (!resetAfterBack) return;
				resetAfterBack = false;
				clearPage(element);
				if (underlay) removeUnderlay(underlay);
			}, 2000);
		} else {
			const curve = '220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
			element.style.transition = `transform ${curve}`;
			element.style.transform = '';
			moveUnderlay(0, `transform ${curve}, opacity ${curve}`);
			const shown = underlay;
			setTimeout(() => {
				clearPage(element);
				if (shown) removeUnderlay(shown);
			}, 230);
		}
	};
	window.addEventListener('touchend', end);
	// A touch taken away while swiping from the edge (by the system): the swipe called off
	window.addEventListener('touchcancel', () => {
		heldTap = null;
		if (!start) return;
		const swiping = tracking;
		start = null;
		tracking = false;
		meter?.cancel();
		meter = null;
		if (swiping) log('edge swipe: the touch was taken away');
		undoSwipe();
	});
	// Gone back without the app (iOS' own swipe after all) while the app's swipe was on: the
	// app's called off, so it isn't two pages back
	window.addEventListener('popstate', () => {
		if (ownBack) return;
		if (tracking || backTimer) {
			log('edge swipe: gone back by the system meanwhile');
			if (backTimer) clearTimeout(backTimer);
			backTimer = null;
			start = null;
			tracking = false;
			swipedBack = true;
			undoSwipe();
		}
	});
	function undoSwipe() {
		resetAfterBack = false;
		const element = page();
		if (element) clearPage(element);
		if (underlay) removeUnderlay(underlay);
	}
}

// --- The page before, under the finger ----------------------------------------------------

/** Pictures of the pages left, by page (a copy of their elements, how far they were scrolled):
 * also the ones left for another tab, so back to a tab's start has its picture too */
const snapshots = new Map<string, { node: HTMLElement; scroll: number }>();
/** Kept of the pages besides the tabs' starts (those are always kept: back from another
 * tab's page goes there, and after a while of going around they had gone, a black swipe) */
const MOST_SNAPSHOTS = 12;

function keepSnapshot(element: HTMLElement | undefined, path: string) {
	if (!element) return;
	const node = element.cloneNode(true) as HTMLElement;
	node.style.transform = '';
	node.style.transition = '';
	node.style.boxShadow = '';
	node.style.position = '';
	node.style.zIndex = '';
	node.style.backgroundColor = '';
	// (the newest last; the oldest go)
	snapshots.delete(path);
	snapshots.set(path, { node, scroll: window.scrollY });
	const others = [...snapshots.keys()].filter((kept) => !rootOf(kept));
	for (const old of others.slice(0, Math.max(0, others.length - MOST_SNAPSHOTS)))
		snapshots.delete(old);
}

let underlay: HTMLElement | null = null;

/** Puts the picture of the page before under this one (else the empty panel) */
function showUnderlay(element: HTMLElement) {
	if (underlay) removeUnderlay(underlay);
	const before = snapshots.get(backTarget());
	// This page above it, solid (else the one under it shows through)
	element.style.position = 'relative';
	element.style.zIndex = '6';
	element.style.backgroundColor = 'var(--color-panel)';
	element.style.willChange = 'transform';
	// (no picture of it: the app's panel at least, not the black behind it)
	const layer = document.createElement('div');
	layer.className = 'fixed inset-0 z-[5] overflow-hidden pointer-events-none';
	layer.style.backgroundColor = 'var(--color-panel)';
	const content = document.createElement('div');
	content.style.willChange = 'transform';
	// (the kept picture itself, not a copy of it: copying a long page at the start of the swipe
	// made it stutter; it's shown once at a time)
	if (before) {
		before.node.style.marginTop = `${-before.scroll}px`;
		content.append(before.node);
	}
	const dim = document.createElement('div');
	dim.className = 'absolute inset-0 bg-black';
	// The shadow of the page above, at its edge (a shadow on the long page itself cost every
	// frame of the swipe)
	const edge = document.createElement('div');
	edge.className = 'absolute inset-y-0 left-0 w-6 -ml-6';
	edge.style.background = 'linear-gradient(to left, rgb(0 0 0 / 0.35), transparent)';
	layer.append(content, dim, edge);
	document.body.append(layer);
	underlay = layer;
	moveUnderlay(0, 'none');
}

/** How far the page above is away (0–1): the page before comes along a little, brightening */
function moveUnderlay(progress: number, transition: string) {
	if (!underlay) return;
	const [content, dim, edge] = underlay.children as unknown as HTMLElement[];
	content.style.transition = transition;
	dim.style.transition = transition;
	edge.style.transition = transition;
	content.style.transform = `translate3d(${-25 * (1 - progress)}%, 0, 0)`;
	edge.style.transform = `translate3d(${progress * 100}vw, 0, 0)`;
	dim.style.opacity = String(0.35 * (1 - progress));
}

function removeUnderlay(layer: HTMLElement) {
	layer.remove();
	if (underlay === layer) underlay = null;
}

function clearPage(element: HTMLElement) {
	element.style.transition = 'none';
	element.style.transform = '';
	element.style.boxShadow = '';
	element.style.willChange = '';
	element.style.position = '';
	element.style.zIndex = '';
	element.style.backgroundColor = '';
}

let backTimer: ReturnType<typeof setTimeout> | null = null;
let swipedBack = false;
let resetAfterBack = false;
let switchingTab = false;
