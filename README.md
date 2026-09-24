# DYAD

A two-colour rhythm game in the browser. Notes scroll toward a ring; hit them
with the matching colour on time. Charts are osu!taiko beatmaps, so anything
made for taiko (by hand or by a model) plays here as-is.

**Play:** https://dyad.duckdns.org

- Two note types: amber and periwinkle. A big note wants both hands.
- Keyboard (landscape): `Z` `X` for the left hand, `M` `,` for the right. Rebind in Settings.
- Touch (portrait): four pads at the bottom of the screen.
- Judgement is Great (±30 ms), OK (±50 ms), Miss. Drumrolls and spinners are bonus objects.
- Records and replays are kept locally, keyed by the chart's content hash.

## Making charts

Charts come from [Mapperatorinator](https://github.com/OliBomby/Mapperatorinator)
(V32, taiko mode) through a Colab notebook in this repo:

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/frontishobby/dyad/blob/main/colab/dyad_taiko_generate.ipynb)

Upload a song, run the cells, download `dyad-<id>.zip`. It holds EASY / NORMAL /
HARD `.osu` charts plus `song.wav` and `song.json`. Then:

```sh
unzip dyad-<id>.zip -d songs-src/
cp cover.png songs-src/<id>/jacket.png     # png / jpg / webp / avif
npm run songs:build                        # → public/songs/<id>/
```

The build converts each `.osu` to `chart.<tier>.json` (deterministic: same
`.osu`, same bytes), encodes the audio to WebM/Opus, makes AVIF jackets,
computes the real osu!taiko star rating with [rosu-pp](https://github.com/MaxOhn/rosu-pp-js)
and writes `meta.json` and `public/songs/index.json`. `songs-src/**/*.wav` is
ignored by git; everything under `public/songs/` is committed.

The notebook can also run headless with the [Colab CLI](https://github.com/googlecolab/colab-cli);
see [`colab/README.md`](colab/README.md).

Charts generated this way are AI-made. Say so wherever you publish them; that
is the model author's one rule.

## Development

```sh
npm install
npm run dev          # Vite dev server
npm test             # vitest
npm run check        # svelte-check
npm run build        # → dist/
```

Requires Node 22+, and for `songs:build` also `ffmpeg` (with libopus) on PATH.

- `src/core/` — the judgement engine. Pure TypeScript, no rendering; `tick(songMs)` and `hit(key, hitMs)` are the whole interface, and a replay is a pure function of the input log.
- `src/render/` — the PixiJS track renderer (one code path for both orientations).
- `src/audio/` — Web Audio playback; judgement runs on `AudioContext.currentTime`, drawing on a smoothed clock.
- `src/ui/` — Svelte 5 screens.
- `tools/` — the song build and the `.osu` converter.
- `colab/` — the chart generation notebook.

Design decisions live in [`DESIGN.md`](DESIGN.md), engineering ones in [`PLAN.md`](PLAN.md).

## Deployment

Pushes to `main` run tests, type-check, build, and deploy to GitHub Pages
(`.github/workflows/pages.yml`). Song assets are served from the same Pages
site; a custom domain is set in `public/CNAME`.

## Built with

Vite, Svelte 5, TypeScript, PixiJS 8, and the work of
[OliBomby/Mapperatorinator](https://github.com/OliBomby/Mapperatorinator) and
[MaxOhn/rosu-pp](https://github.com/MaxOhn/rosu-pp).
