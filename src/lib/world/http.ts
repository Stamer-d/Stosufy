// Asking the trackers' services: within a time, given up when the map moves on (the signal),
// with an error that says which service failed. The keyed services (worldwide webcams, ships,
// fire hotspots) are asked through the Stamer API, which holds their keys.

import { fastFetch } from '../fastFetch';
import { freshToken } from '../stores/auth';
import { API_URL } from '../api';

const TIMEOUT_MS = 20000;

async function ask(url: string, signal?: AbortSignal, init: RequestInit = {}, ms = TIMEOUT_MS) {
	const controller = new AbortController();
	const stop = () => controller.abort();
	signal?.addEventListener('abort', stop);
	const timer = setTimeout(stop, ms);
	try {
		const response = await fastFetch(url, { ...init, signal: controller.signal });
		if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
		return response;
	} catch (error: any) {
		if (signal?.aborted) throw error;
		if (controller.signal.aborted)
			throw new Error(`${new URL(url).host} didn't answer within ${Math.round(ms / 1000)} s`);
		throw error;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', stop);
	}
}

export async function getJson<T = any>(
	url: string,
	signal?: AbortSignal,
	init?: RequestInit,
	ms?: number
): Promise<T> {
	const response = await ask(url, signal, init, ms);
	// Some answer "no content" when there's nothing
	if (response.status === 204) return null as T;
	return response.json();
}

export async function getText(url: string, signal?: AbortSignal, ms?: number) {
	return (await ask(url, signal, {}, ms)).text();
}

/** An XML answer (feeds) as a document */
export async function getXml(url: string, signal?: AbortSignal) {
	const text = await getText(url, signal);
	return new DOMParser().parseFromString(text, 'application/xml');
}

/** The text of the first element of a name (with or without its namespace prefix) */
export function xmlText(parent: Element | Document, name: string) {
	const local = name.includes(':') ? name.split(':')[1] : name;
	const found =
		parent.getElementsByTagName(name)[0] ?? parent.getElementsByTagNameNS('*', local)[0];
	return found?.textContent?.trim() ?? '';
}

/** Not set up on the server (no key): the tracker says so instead of failing */
export class NotConfigured extends Error {}

/** Through the Stamer API (`/v2/world/…`), as the logged-in user */
export async function backendJson<T = any>(path: string, signal?: AbortSignal): Promise<T> {
	const token = await freshToken().catch(() => '');
	const response = await ask(
		`${API_URL}world/${path}`,
		signal,
		{ headers: token ? { Authorization: `Bearer ${token}` } : {} },
		25000
	).catch((error) => {
		if (/answered 503/.test(error.message)) throw new NotConfigured('Not set up on the server yet');
		throw error;
	});
	return response.json();
}

/** Some at a time (services that are asked once per road, network …) */
export async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>) {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += size)
		results.push(...(await Promise.all(items.slice(i, i + size).map(run))));
	return results;
}

/** Kept between loads for a while (services that ask not to be asked often) */
const cache = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ms: number, make: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < ms) return hit.value as T;
	try {
		const stored = JSON.parse(localStorage.getItem(`world:${key}`) ?? 'null');
		if (stored && Date.now() - stored.at < ms) {
			cache.set(key, stored);
			return stored.value;
		}
	} catch {
		// No storage: asked again
	}
	const value = await make();
	const entry = { at: Date.now(), value };
	cache.set(key, entry);
	try {
		localStorage.setItem(`world:${key}`, JSON.stringify(entry));
	} catch {
		// Too big to keep, or no storage
	}
	return value;
}
