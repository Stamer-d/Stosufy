import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	optimizeDeps: {
		exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
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
	build: {
		rollupOptions: {
			output: {
				// Ensure workers are properly emitted
				manualChunks: (id) => {
					if (id.includes('workers')) {
						return 'workers';
					}
				}
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
