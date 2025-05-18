import { fetch } from "@tauri-apps/plugin-http";
import { get, writable } from "svelte/store";
import { keyStore } from "./auth";
export const playlists = writable([]);

export async function getPlaylists(code) {
  const response = await fetch("https://api.stamer-d.de/stosufy/playlist/", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${code}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

export async function createPlaylist(title) {
  const response = await fetch(
    "https://api.stamer-d.de/stosufy/playlist/create",
    {
      method: "POST",
      body: JSON.stringify({
        title: title,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${get(keyStore).access_token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

export async function deletePlaylist(id) {
  const response = await fetch(
    "https://api.stamer-d.de/stosufy/playlist/delete",
    {
      method: "POST",
      body: JSON.stringify({
        id: id,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${get(keyStore).access_token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data;
}
