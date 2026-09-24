/**
 * Current Theme, following settings.value.theme (DESIGN §6). The theme is
 * injected into <html> as CSS custom properties via applyTheme(); components
 * that need colour values in JS (Pixi) read theme.value.
 */
import { THEMES, applyTheme, type Theme } from '../design/tokens.ts';
import { settings } from './settings.svelte.ts';

const value: Theme = $derived(THEMES[settings.value.theme]);

function inject(theme: Theme): void {
  if (typeof document === 'undefined') return;
  applyTheme(theme);
  // The browser chrome colour follows `void`, the letterbox colour outside the stage.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.void);
}

// Inject synchronously so the first paint already has the variables, then keep
// following the setting. The root effect lives for the app's lifetime.
inject(THEMES[settings.value.theme]);
$effect.root(() => {
  $effect(() => {
    inject(value);
  });
});

export const theme: { readonly value: Theme } = {
  get value() {
    return value;
  },
};
