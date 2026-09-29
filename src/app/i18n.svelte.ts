/**
 * UI strings in the current language, following settings.value.locale.
 * Components read t().section.key; the read is reactive, so switching the
 * language in settings re-renders every visible string. Also keeps <html lang>
 * and the body font stack in step (screen readers and CJK glyph forms).
 */
import { TYPE } from '../design/tokens.ts';
import { MESSAGES, type Messages } from './i18n/index.ts';
import { LOCALE_TAGS, type Locale } from './locale.ts';
import { settings } from './settings.svelte.ts';

const locale: Locale = $derived(settings.value.locale);
const messages: Messages = $derived(MESSAGES[locale]);

export function t(): Messages {
  return messages;
}

function inject(locale: Locale): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = LOCALE_TAGS[locale];
  root.style.setProperty('--font-body', TYPE.bodyFor[locale]);
}

// Same pattern as theme.svelte.ts: first paint already right, then follow the setting.
inject(settings.value.locale);
$effect.root(() => {
  $effect(() => {
    inject(locale);
  });
});
