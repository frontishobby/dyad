import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { fitStandaloneWindow, registerServiceWorker } from './app/pwa.ts';

const target = document.getElementById('app');
if (!target) throw new Error('#app not found');
// index.html ships a static intro inside #app for crawlers; the app replaces it.
target.replaceChildren();

export default mount(App, { target });

registerServiceWorker();
fitStandaloneWindow();
