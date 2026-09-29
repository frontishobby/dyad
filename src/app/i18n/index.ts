/** Every UI language's strings, keyed by locale. Framework-free (tests import it). */
import type { Locale } from '../locale.ts';
import { en, type Messages } from './en.ts';
import { ja } from './ja.ts';
import { ko } from './ko.ts';
import { zh } from './zh.ts';

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { en, ko, ja, zh };
