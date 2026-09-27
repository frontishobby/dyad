/**
 * Credits screen content. Third-party music must name the author, the title
 * it was published under, the licence and the source, and say what we changed
 * (CC-BY / OGA-BY §4). Keep this in step with songs-src/ when a song is added.
 */

export interface License {
  name: string;
  url: string;
}

export const LICENSES = {
  cc0: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  ogaBy3: { name: 'OGA-BY 3.0', url: 'https://static.opengameart.org/OGA-BY-3.0.txt' },
} as const satisfies Record<string, License>;

export interface MusicCredit {
  /** Title shown in the game. */
  title: string;
  artist: string;
  /** Where a third-party track came from; absent for original songs. */
  source?: {
    /** Title the author published it under. */
    title: string;
    url: string;
    license: License;
    /** What we changed, in Korean. */
    changes?: string;
  };
}

export const MUSIC: readonly MusicCredit[] = [
  { title: 'Afterglow', artist: 'Original' },
  { title: 'Apotheosis', artist: 'Original' },
  { title: 'Glass Horizon', artist: 'Original' },
  {
    title: 'Lucid Trigger',
    artist: 'Liq_mmry',
    source: {
      title: 'Lucid Trigger',
      url: 'https://opengameart.org/content/lucid-trigger',
      license: LICENSES.cc0,
      changes: '끝부분을 잘라 짧게 페이드',
    },
  },
  { title: 'Malice', artist: 'Original' },
  { title: 'Tailwind', artist: 'Original' },
];

export interface ToolCredit {
  name: string;
  by: string;
  url: string;
  /** What it does here, in Korean. */
  role: string;
}

export const TOOLS: readonly ToolCredit[] = [
  {
    name: 'Mapperatorinator',
    by: 'OliBomby',
    url: 'https://github.com/OliBomby/Mapperatorinator',
    role: '모든 채보 생성 (AI)',
  },
  { name: 'rosu-pp', by: 'MaxOhn', url: 'https://github.com/MaxOhn/rosu-pp', role: '난이도 계산' },
  { name: 'PixiJS', by: 'PixiJS', url: 'https://pixijs.com', role: '플레이 화면 렌더링' },
  { name: 'Svelte', by: 'Svelte', url: 'https://svelte.dev', role: 'UI' },
  { name: 'Vite', by: 'VoidZero', url: 'https://vite.dev', role: '빌드' },
];
