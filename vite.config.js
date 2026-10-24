/// <reference types="node" />
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({
				fallback: 'index.html'
			})
		}),
		tailwindcss()
	],
	optimizeDeps: {
		exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
	},
	build: {
		// three.js (the puzzle's 3D view) is one chunk of ~600 kB, loaded only when it opens
		chunkSizeWarningLimit: 700
	},
	worker: {
		format: 'es',
		plugins: () => [],
		rollupOptions: {
			output: {
				format: 'es'
			}
		}
	},
	// Vite options tailored for Tauri development
	clearScreen: false,
	server: {
		port: 2021,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 2021
				}
			: undefined,
		watch: {
			ignored: ['**/src-tauri/**']
		}
	}
});
