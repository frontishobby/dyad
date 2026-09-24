/**
 * Stage (PLAN §3 "렌더 좌표"): a Pixi Application at the logical resolution.
 *
 * Landscape: fixed 1280×720, aspect-fit into the container, never upscaled
 * beyond 1× (the physical note size must not vary with the viewport), the
 * rest of the container is a `void` letterbox.
 *
 * Portrait: logical width 720, logical height follows the container aspect
 * (portraitLogical()); the canvas fills the container, so the scale is simply
 * containerWidth / 720 and may exceed 1 on tablets. When the container
 * resizes and the logical height changes, the renderer is resized and
 * onResize listeners fire so the play screen can recompute its layout.
 *
 * The play screen drives rendering by calling `render()` from its own rAF
 * loop; Pixi's ticker is never started.
 */
import { Application, Container } from 'pixi.js';
import { LAYOUT, hexToNumber, type Theme } from '../design/tokens.ts';
import { defaultLogical, portraitLogical, type Logical } from './layout.ts';
import type { Orientation, Stage } from './types.ts';

function devicePixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 2);
}

function containerSize(container: HTMLElement): { w: number; h: number } {
  return { w: container.clientWidth, h: container.clientHeight };
}

export async function createStage(container: HTMLElement, orientation: Orientation, theme: Theme): Promise<Stage> {
  const fixed = orientation === 'landscape';
  const initial = containerSize(container);
  const logical: Logical = fixed
    ? { w: LAYOUT.landscape.width, h: LAYOUT.landscape.height }
    : initial.w > 0 && initial.h > 0
      ? portraitLogical(initial.w, initial.h)
      : defaultLogical('portrait');

  const app = new Application();
  await app.init({
    width: logical.w,
    height: logical.h,
    backgroundColor: hexToNumber(theme.ground),
    antialias: true,
    resolution: devicePixelRatio(),
    autoDensity: true,
    preference: 'webgl',
    autoStart: false,
  });

  const canvas = app.canvas as HTMLCanvasElement;

  // Container = frame (letterbox in landscape); canvas = the logical surface.
  const savedContainerStyle = {
    background: container.style.background,
    position: container.style.position,
    overflow: container.style.overflow,
  };
  container.style.background = theme.void;
  container.style.overflow = 'hidden';
  if (typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  canvas.style.position = 'absolute';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  (canvas.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  let scale = 1;
  let destroyed = false;
  const listeners = new Set<(logical: Logical) => void>();

  function place(w: number, h: number, cw: number, ch: number): void {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${(cw - w) / 2}px`;
    canvas.style.top = `${(ch - h) / 2}px`;
  }

  function fit(): void {
    if (destroyed) return;
    const { w: cw, h: ch } = containerSize(container);
    if (!(cw > 0) || !(ch > 0)) return;

    if (fixed) {
      // Never above 1: no upscaling (PLAN §3).
      scale = Math.min(cw / logical.w, ch / logical.h, 1);
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;
      place(logical.w * scale, logical.h * scale, cw, ch);
      return;
    }

    // Portrait: the logical height follows the container; the canvas fills it.
    const next = portraitLogical(cw, ch);
    const changed = next.h !== logical.h;
    if (changed) {
      logical.h = next.h;
      app.renderer.resize(logical.w, logical.h);
    }
    scale = cw / logical.w;
    // With the height clamped, an extreme aspect leaves a sliver of void; keep the scale uniform.
    place(cw, logical.h * scale, cw, ch);
    if (changed) for (const cb of listeners) cb({ w: logical.w, h: logical.h });
  }

  function toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? logical.w / rect.width : 1;
    const sy = rect.height > 0 ? logical.h / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  let observer: ResizeObserver | null = null;
  const onWindowResize = (): void => fit();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => fit());
    observer.observe(container);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
  fit();

  const stage: Container = app.stage;

  return {
    canvas,
    stage,
    orientation,
    logical,
    get scale() {
      return scale;
    },
    toLogical,
    fit,
    onResize(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    render() {
      if (!destroyed) app.render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      observer?.disconnect();
      observer = null;
      if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize);
      app.destroy({ removeView: true }, { children: true, context: true });
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      container.style.background = savedContainerStyle.background;
      container.style.position = savedContainerStyle.position;
      container.style.overflow = savedContainerStyle.overflow;
    },
  };
}
