import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import tailwindcss from '@tailwindcss/vite';

import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		tailwindcss(), 
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			manifest: false // we will supply our own static/manifest.webmanifest
		})
	],
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:8787',
				changeOrigin: true
			}
		}
	}
});
