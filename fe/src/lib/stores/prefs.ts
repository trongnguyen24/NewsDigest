import { writable } from 'svelte/store';

export const prefs = writable({
  darkMode: false,
  apiKey: '',
  notificationsEnabled: false,
});
