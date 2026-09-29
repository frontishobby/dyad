<script lang="ts">
  import { formatHiSpeed, formatPercent, prettyKeyCode } from '../app/format.ts';
  import { t } from '../app/i18n.svelte.ts';
  import { LOCALES, LOCALE_NAMES, LOCALE_TAGS } from '../app/locale.ts';
  import { screen } from '../app/screen.svelte.ts';
  import { SETTINGS_RANGE, isKeyCode } from '../app/settings-io.ts';
  import { settings } from '../app/settings.svelte.ts';
  import { KEYS, type Key } from '../core/types.ts';
  import Button from './components/Button.svelte';
  import ShapeIcon from './components/ShapeIcon.svelte';
  import { keyHand, keyKind } from '../core/types.ts';

  const SOURCE_URL = 'https://github.com/frontishobby/dyad';

  /** Rows in hand order, outer to outer: left kat, left don, right don, right kat. */
  const KEY_ROWS: readonly Key[] = ['KL', 'DL', 'DR', 'KR'];

  /** Guidance is shape-based (DESIGN §2): the icon says which note, the text which hand. */
  function handLabel(key: Key): string {
    return keyHand(key) === 'L' ? t().settings.leftHand : t().settings.rightHand;
  }

  const s = $derived(settings.value);

  /** Pad key currently waiting for a keypress, if any. */
  let listening = $state<Key | null>(null);

  function bind(key: Key, code: string): void {
    const bindings = { ...s.bindings };
    // Another pad key already uses this code: swap so no two keys collide.
    for (const other of KEYS) {
      if (other !== key && bindings[other] === code) bindings[other] = bindings[key];
    }
    bindings[key] = code;
    settings.update({ bindings });
  }

  function toggleListen(key: Key): void {
    listening = listening === key ? null : key;
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    if (listening === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      listening = null;
      return;
    }
    if (!isKeyCode(e.code)) return;
    bind(listening, e.code);
    listening = null;
  }

  type NumberEvent = Event & { currentTarget: EventTarget & HTMLInputElement };

  /** Read a number input; ignore incomplete text. */
  function numberOf(e: NumberEvent): number | null {
    const n = e.currentTarget.valueAsNumber;
    return Number.isFinite(n) ? n : null;
  }

  /** Commit and echo the validated value back (the store may clamp it). */
  function commit(e: NumberEvent, field: 'hiSpeed' | 'audioOffset' | 'inputOffset' | 'hitSoundVolume'): void {
    const n = numberOf(e);
    if (n !== null) settings.update({ [field]: n });
    e.currentTarget.value = String(settings.value[field]);
  }
</script>

<svelte:window onkeydowncapture={onWindowKeydown} />

<main class="screen">
  <header class="screen-head">
    <h1>{t().settings.title}</h1>
    <Button id="settings-back" variant="primary" onclick={() => screen.go({ name: 'title' })}>{t().common.back}</Button>
  </header>

  <section aria-labelledby="h-keys">
    <h2 id="h-keys">{t().settings.keys}</h2>
    <div class="rows">
      {#each KEY_ROWS as key (key)}
        <div class="row">
          <span class="label key-label" id="label-{key}">
            <ShapeIcon kind={keyKind(key)} width={36} />
            <span>{handLabel(key)}</span>
            <span class="sr">{keyKind(key) === 'k' ? t().settings.angledNote : t().settings.straightNote}, {handLabel(key)}</span>
          </span>
          <div class="control">
            <kbd class="key" class:listening={listening === key} aria-labelledby="label-{key}">
              {listening === key ? '…' : prettyKeyCode(s.bindings[key])}
            </kbd>
            <Button id="bind-{key}" size="sm" onclick={() => toggleListen(key)}>
              {listening === key ? t().settings.cancel : t().settings.change}
            </Button>
            {#if listening === key}
              <span class="dim caption" aria-live="polite">{t().settings.pressKey}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section aria-labelledby="h-play">
    <h2 id="h-play">{t().settings.play}</h2>
    <div class="rows">
      <div class="row">
        <label class="label" for="hispeed">{t().settings.hiSpeed}</label>
        <div class="control">
          <input
            id="hispeed"
            type="range"
            min={SETTINGS_RANGE.hiSpeed.min}
            max={SETTINGS_RANGE.hiSpeed.max}
            step={SETTINGS_RANGE.hiSpeed.step}
            value={s.hiSpeed}
            aria-valuetext={formatHiSpeed(s.hiSpeed)}
            oninput={(e) => {
              const n = numberOf(e);
              if (n !== null) settings.update({ hiSpeed: n });
            }}
          />
          <input
            id="hispeed-number"
            class="field narrow"
            type="number"
            inputmode="decimal"
            min={SETTINGS_RANGE.hiSpeed.min}
            max={SETTINGS_RANGE.hiSpeed.max}
            step={SETTINGS_RANGE.hiSpeed.step}
            value={s.hiSpeed}
            aria-label={t().settings.hiSpeedValue}
            onchange={(e) => commit(e, 'hiSpeed')}
          />
          <span class="dim caption">{formatHiSpeed(s.hiSpeed)}</span>
        </div>
      </div>
    </div>
  </section>

  <section aria-labelledby="h-timing">
    <h2 id="h-timing">{t().settings.timing}</h2>
    <p class="dim caption">{t().settings.timingHint}</p>
    <div class="rows">
      <div class="row">
        <label class="label" for="audio-offset">{t().settings.audioOffset}</label>
        <div class="control">
          <input
            id="audio-offset"
            class="field narrow"
            type="number"
            inputmode="numeric"
            min={SETTINGS_RANGE.offsetMs.min}
            max={SETTINGS_RANGE.offsetMs.max}
            step={SETTINGS_RANGE.offsetMs.step}
            value={s.audioOffset}
            onchange={(e) => commit(e, 'audioOffset')}
          />
          <span class="dim caption">{t().settings.audioOffsetHint}</span>
        </div>
      </div>
      <div class="row">
        <label class="label" for="input-offset">{t().settings.inputOffset}</label>
        <div class="control">
          <input
            id="input-offset"
            class="field narrow"
            type="number"
            inputmode="numeric"
            min={SETTINGS_RANGE.offsetMs.min}
            max={SETTINGS_RANGE.offsetMs.max}
            step={SETTINGS_RANGE.offsetMs.step}
            value={s.inputOffset}
            onchange={(e) => commit(e, 'inputOffset')}
          />
          <span class="dim caption">{t().settings.inputOffsetHint}</span>
        </div>
      </div>
      <div class="row">
        <span class="label"></span>
        <div class="control">
          <Button id="recalibrate" onclick={() => screen.go({ name: 'calibrate', returnTo: 'settings' })}>
            {t().settings.calibrate}
          </Button>
        </div>
      </div>
    </div>
  </section>

  <section aria-labelledby="h-look">
    <h2 id="h-look">{t().settings.look}</h2>
    <div class="rows">
      <div class="row">
        <span class="label" id="label-locale">{t().settings.language}</span>
        <div class="control">
          <div class="segment" role="radiogroup" aria-labelledby="label-locale">
            {#each LOCALES as locale (locale)}
              <label>
                <input
                  id="locale-{locale}"
                  type="radio"
                  name="locale"
                  value={locale}
                  checked={s.locale === locale}
                  onchange={() => settings.update({ locale })}
                />
                <span lang={LOCALE_TAGS[locale]}>{LOCALE_NAMES[locale]}</span>
              </label>
            {/each}
          </div>
        </div>
      </div>

      <div class="row">
        <span class="label" id="label-theme">{t().settings.theme}</span>
        <div class="control">
          <div class="segment" role="radiogroup" aria-labelledby="label-theme">
            <label>
              <input
                id="theme-dark"
                type="radio"
                name="theme"
                value="dark"
                checked={s.theme === 'dark'}
                onchange={() => settings.update({ theme: 'dark' })}
              />
              <span>{t().settings.dark}</span>
            </label>
            <label>
              <input
                id="theme-light"
                type="radio"
                name="theme"
                value="light"
                checked={s.theme === 'light'}
                onchange={() => settings.update({ theme: 'light' })}
              />
              <span>{t().settings.light}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="row">
        <label class="label" for="master-volume">{t().settings.masterVolume}</label>
        <div class="control">
          <input
            id="master-volume"
            type="range"
            min={SETTINGS_RANGE.volume.min}
            max={SETTINGS_RANGE.volume.max}
            step={SETTINGS_RANGE.volume.step}
            value={s.masterVolume}
            aria-valuetext={formatPercent(s.masterVolume)}
            oninput={(e) => {
              const n = numberOf(e);
              if (n !== null) settings.update({ masterVolume: n });
            }}
          />
          <span class="dim caption">{formatPercent(s.masterVolume)}</span>
        </div>
      </div>

      <div class="row">
        <label class="label" for="hit-volume">{t().settings.hitVolume}</label>
        <div class="control">
          <input
            id="hit-volume"
            type="range"
            min={SETTINGS_RANGE.volume.min}
            max={SETTINGS_RANGE.volume.max}
            step={SETTINGS_RANGE.volume.step}
            value={s.hitSoundVolume}
            aria-valuetext={formatPercent(s.hitSoundVolume)}
            oninput={(e) => {
              const n = numberOf(e);
              if (n !== null) settings.update({ hitSoundVolume: n });
            }}
          />
          <span class="dim caption">{formatPercent(s.hitSoundVolume)}</span>
        </div>
      </div>
    </div>
  </section>

  <footer class="foot">
    <Button id="settings-reset" onclick={() => settings.reset()}>{t().settings.reset}</Button>
    <Button id="open-credits" onclick={() => screen.go({ name: 'credits' })}>{t().settings.credits}</Button>
    <a id="source-code" class="source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Source Code</a>
  </footer>
</main>

<style>
  .key-label {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  h1 {
    font-size: 20px;
    font-weight: 500;
  }

  section {
    display: grid;
    gap: 12px;
  }

  h2 {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-dim);
  }

  .rows {
    display: grid;
    gap: 8px;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(120px, 200px) 1fr;
    align-items: center;
    gap: 16px;
    min-height: 48px;
  }

  .control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 40px;
    height: 40px;
    padding: 0 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 5px;
    font-family: inherit;
    font-weight: 500;
  }

  .key.listening {
    border-color: var(--kat);
    color: var(--kat-ink);
  }

  .narrow {
    width: 96px;
  }

  input[type='range'] {
    width: min(240px, 100%);
  }

  .segment {
    display: inline-flex;
    height: 40px;
    border: 1px solid var(--line);
    border-radius: 5px;
    overflow: hidden;
  }

  .segment label {
    position: relative;
    display: flex;
  }

  .segment input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .segment span {
    display: flex;
    align-items: center;
    padding: 0 16px;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .segment input:checked + span {
    background: var(--kat);
    color: var(--on-kat);
  }

  .segment input:focus-visible + span {
    outline: 2px solid var(--kat);
    outline-offset: -2px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }

  .source {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    margin-inline-start: auto;
    font-size: 14px;
    color: var(--kat-ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .source:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }

  @media (max-width: 479px) {
    .row {
      grid-template-columns: 1fr;
      gap: 4px;
      padding-block: 4px;
    }
    /* Four language names fit a 360 px phone only with tighter padding. */
    .segment span {
      padding: 0 12px;
    }
  }
</style>
