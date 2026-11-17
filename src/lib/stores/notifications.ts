// Notifications in the app: cards that slide in from the right, for things that happen
// without the user doing them right then (a friend comes online, a download is done, the
// connection is lost). Each kind can be turned off in the settings. Short confirmations of
// what the user just did stay toasts (toast.ts).

import { get, writable } from 'svelte/store';
import type { Settings } from '../types';

export type NotificationKind =
	'friendOnline' | 'friendOffline' | 'sessions' | 'downloads' | 'connection' | 'updates';

export const NOTIFICATION_KINDS: { id: NotificationKind; label: string; description: string }[] = [
	{
		id: 'friendOnline',
		label: 'Friends come online',
		description: 'When one of your osu! friends who uses Stosufy opens it.'
	},
	{
		id: 'friendOffline',
		label: 'Friends go offline',
		description: 'When one of them closes Stosufy.'
	},
	{
		id: 'sessions',
		label: 'Listening sessions',
		description: 'When a friend starts one, and when someone joins or leaves yours.'
	},
	{
		id: 'downloads',
		label: 'Downloads',
		description: 'When a download is done or fails, and when a batch of downloads is done.'
	},
	{
		id: 'connection',
		label: 'Connection',
		description: 'When you go offline and when you are back online.'
	},
	{
		id: 'updates',
		label: 'Updates',
		description: 'When a new version of Stosufy is available.'
	}
];

export interface AppNotification {
	id: number;
	kind: NotificationKind;
	title: string;
	body?: string;
	/** A picture on the left: an avatar (round) or a cover */
	image?: string | null;
	round?: boolean;
	/** Without a picture: an icon (an icon-[…] class) */
	icon?: string;
	/** The icon's color class, e.g. text-green-400 */
	tone?: string;
	/** A button, e.g. "Join" */
	action?: { label: string; run: () => void };
	/** Clicking the card itself */
	open?: () => void;
	/** How long it stays (ms) */
	duration: number;
	/** Shown even with its kind turned off (not with all of them off), e.g. the test one */
	always?: boolean;
}

/** At most this many at once: the oldest go first */
const MAX_SHOWN = 4;
const DEFAULT_DURATION = 6000;

export const notifications = writable<AppNotification[]>([]);

let nextId = 0;
const timers = new Map<
	number,
	{ timer: ReturnType<typeof setTimeout> | null; left: number; since: number }
>();

/**
 * The user's notification settings; Notifications.svelte keeps them up to date (the stores
 * that notify are loaded before the user's settings, which need them in turn)
 */
export const notificationSettings = writable<Settings['notifications']>(undefined);

/** Whether notifications of a kind are on (all are, unless turned off) */
export function notificationsOn(kind: NotificationKind) {
	const settings = get(notificationSettings);
	return settings?.enabled !== false && settings?.kinds?.[kind] !== false;
}

/** Shows a notification, if its kind is on; returns its id (or null) */
export function notify(
	notification: Omit<AppNotification, 'id' | 'duration'> & { duration?: number }
): number | null {
	const settings = get(notificationSettings);
	if (settings?.enabled === false) return null;
	if (!notification.always && !notificationsOn(notification.kind)) return null;
	const id = nextId++;
	const entry: AppNotification = { duration: DEFAULT_DURATION, ...notification, id };
	notifications.update((all) => {
		const next = [...all, entry];
		for (const old of next.slice(0, Math.max(0, next.length - MAX_SHOWN))) clearTimer(old.id);
		return next.slice(-MAX_SHOWN);
	});
	timers.set(id, { timer: null, left: entry.duration, since: 0 });
	resume(id);
	return id;
}

export function dismiss(id: number) {
	clearTimer(id);
	notifications.update((all) => all.filter((n) => n.id !== id));
}

function clearTimer(id: number) {
	const entry = timers.get(id);
	if (entry?.timer) clearTimeout(entry.timer);
	timers.delete(id);
}

/** Stops the countdown, while the pointer is on it */
export function pause(id: number) {
	const entry = timers.get(id);
	if (!entry?.timer) return;
	clearTimeout(entry.timer);
	entry.timer = null;
	entry.left -= Date.now() - entry.since;
}

/** Goes on with the countdown */
export function resume(id: number) {
	const entry = timers.get(id);
	if (!entry || entry.timer) return;
	entry.since = Date.now();
	entry.timer = setTimeout(() => dismiss(id), Math.max(1500, entry.left));
}
