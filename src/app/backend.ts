/**
 * The one Backend instance the shell screens share. LocalBackend is stateless
 * (it reads storage on every call), so other modules may also create their own.
 */
import { createLocalBackend } from '../backend/index.ts';
import type { Backend } from '../backend/types.ts';

export const backend: Backend = createLocalBackend();
