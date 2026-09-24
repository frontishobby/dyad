/**
 * PWA glue: register the service worker (production only) and, when running
 * as an installed app on a desktop, ask for a 1280×720 content area so the
 * game shows at its native size instead of a stretched letterbox.
 *
 * Browsers only honour window.resizeTo() for windows they let scripts manage;
 * installed-app windows generally qualify, ordinary tabs never do. It is a
 * request, not a guarantee, so everything here is best effort and silent.
 */
import { LAYOUT } from '../design/tokens.ts';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches;
}

/**
 * Desired outer size for a window whose inner (content) area should be
 * LAYOUT.landscape: the current chrome (title bar, borders) is added on.
 */
export function standaloneOuterSize(win: {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
}): { width: number; height: number } {
  const chromeW = Math.max(0, win.outerWidth - win.innerWidth);
  const chromeH = Math.max(0, win.outerHeight - win.innerHeight);
  return { width: LAYOUT.landscape.width + chromeW, height: LAYOUT.landscape.height + chromeH };
}

/** Coarse-pointer devices (phones, tablets) keep their screen; only a desktop app window is resized. */
export function fitStandaloneWindow(): void {
  if (!isStandalone()) return;
  if (window.matchMedia('(pointer: coarse)').matches) return;
  const target = standaloneOuterSize(window);
  if (window.innerWidth === LAYOUT.landscape.width && window.innerHeight === LAYOUT.landscape.height) return;
  try {
    window.resizeTo(target.width, target.height);
  } catch {
    // Not permitted here; the letterboxed frame is the fallback.
  }
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err: unknown) => {
      console.warn('dyad: service worker registration failed', err);
    });
  });
}
