// How the web app moves between pages, like an app on a phone:
// - each tab keeps where you were in it (tapping it again goes back to its start, and at
//   its start scrolls to the top)
// - a new page slides in a little (from the right, or the left going back); tabs fade
// - installed on the home screen, a swipe from the left edge goes back (iOS has no back
//   gesture for web apps there)

import { haptic } from './haptics';
import { writable, get } from 'svelte/store';
import { goto, onNavigate, afterNavigate } from '$app/navigation';

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
let depth = 0;
let replacing = false;

/** Back to the page before; if there's none in this visit, to `fallback` (in its place) */
export function goBack(fallback?: string) {
	if (depth > 0) {
		history.back();
		return;
	}
	replacing = true;
	goto(fallback ?? TABS.find((tab) => tab.id === get(currentTab))!.root, { replaceState: true });
}

/** Whether there's a page of this visit to go back to */
export const canGoBack = () => depth > 0;

const standalone = () =>
	matchMedia('(display-mode: standalone)').matches ||
	!!(navigator as Navigator & { standalone?: boolean }).standalone;

/** Set up in the layout: the slides between pages, and the tabs following the pages */
export function setupNavigation(page: () => HTMLElement | undefined) {
	afterNavigate((navigation) => {
		const { to } = navigation;
		// (counting the pages of this visit behind this one)
		if (navigation.type === 'enter') depth = 0;
		else if (navigation.type === 'popstate')
			depth = Math.max(0, depth + ((navigation as { delta?: number }).delta ?? -1));
		else if (navigation.from && navigation.from.url.href !== to?.url.href && !replacing) depth++;
		replacing = false;
		const path = to?.url.pathname;
		if (!path) return;
		const root = rootOf(path);
		if (root) currentTab.set(root);
		lastPath[get(currentTab)] = path;
	});

	// Only the new page moves (sliding in, or fading for another tab): cheap for a phone, not
	// a picture of the whole page as the View Transitions API takes
	let kind: 'forward' | 'back' | 'fade' | 'none' = 'none';
	onNavigate((navigation) => {
		const from = navigation.from?.url.pathname;
		const to = navigation.to?.url.pathname;
		if (!from || !to || from === to) return void (kind = 'none');
		const back =
			navigation.type === 'popstate'
				? ((navigation as { delta?: number }).delta ?? -1) < 0
				: !!rootOf(to) && !rootOf(from);
		kind = swipedBack
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
			element.style.transition = 'none';
			element.style.transform = '';
			element.style.boxShadow = '';
			element.animate(
				[
					{ transform: 'translate3d(-25%, 0, 0)', opacity: 0.6 },
					{ transform: 'none', opacity: 1 }
				],
				{ duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
			);
			return;
		}
		if (!element || kind === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches)
			return;
		const frames: Keyframe[] =
			kind === 'fade'
				? [{ opacity: 0 }, { opacity: 1 }]
				: [
						{ transform: `translateX(${kind === 'forward' ? 36 : -36}px)`, opacity: 0.3 },
						{ transform: 'none', opacity: 1 }
					];
		element.animate(frames, {
			duration: kind === 'fade' ? 140 : 200,
			easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
		});
		kind = 'none';
	});

	// Swipe from the left edge: back. The page follows the finger; let go far or fast enough
	// and it slides away, the page before slides in.
	let start: { x: number; y: number } | null = null;
	let dx = 0;
	let tracking = false;
	let samples: { x: number; t: number }[] = [];
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
			if (!tracking) {
				if (Math.abs(y) > Math.abs(x) && Math.abs(y) > 10) return void (start = null);
				if (x < 8) return;
				tracking = true;
			}
			const now = performance.now();
			samples.push({ x: touch.clientX, t: now });
			while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
			dx = Math.max(0, x);
			const element = page();
			if (element) {
				element.style.transition = 'none';
				element.style.transform = `translate3d(${dx}px, 0, 0)`;
				element.style.boxShadow = '-12px 0 30px rgb(0 0 0 / 0.5)';
			}
		},
		{ passive: true }
	);
	const end = () => {
		if (!start) return;
		start = null;
		const element = page();
		if (!tracking || !element) return;
		const first = samples[0];
		const last = samples[samples.length - 1];
		const speed = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
		const width = window.innerWidth;
		const back = speed > 0.35 || (dx > width * 0.35 && speed > -0.2);
		if (back) {
			haptic();
			// Slides away the rest of the way, then the page before comes
			const duration = Math.max(90, Math.min(220, (width - dx) / Math.max(speed, 1.2)));
			element.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
			element.style.transform = `translate3d(${width}px, 0, 0)`;
			setTimeout(() => {
				swipedBack = true;
				resetAfterBack = true;
				goBack();
				// (if the page before doesn't come, this one doesn't stay away)
				setTimeout(() => {
					if (!resetAfterBack) return;
					resetAfterBack = false;
					element.style.transition = 'transform 200ms ease-out';
					element.style.transform = '';
					element.style.boxShadow = '';
				}, 1500);
			}, duration);
		} else {
			element.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
			element.style.transform = '';
			setTimeout(() => (element.style.boxShadow = ''), 220);
		}
	};
	window.addEventListener('touchend', end);
	window.addEventListener('touchcancel', end);
}

let swipedBack = false;
let resetAfterBack = false;
let switchingTab = false;
