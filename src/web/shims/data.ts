// The web app has no library of downloaded songs: the songs stream (or are kept by
// src/web/downloads.ts). What the shared stores ask of the library is empty here.

import { writable } from 'svelte/store';
import type { MapSet, StoredMapSet } from '../../lib/types';

export const mapDataStore = writable<Record<string, StoredMapSet>>({});
export const librarySongs = (): MapSet[] => [];
