/**
 * Small file helpers shared by the build tools. Everything here is
 * deterministic: hashing is sha256 over exact bytes, and writes are skipped
 * when the target already holds the same bytes so repeated builds leave
 * mtimes alone.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function sha256Hex(...parts: readonly (Uint8Array | string)[]): string {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest('hex');
}

/** First 8 hex characters of sha256 over the bytes: the content-hash tag in file names. */
export function hash8(bytes: Uint8Array): string {
  return sha256Hex(bytes).slice(0, 8);
}

export async function readFileOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  return (await readFileOrNull(path)) !== null;
}

/**
 * Write `bytes` to `path` unless the file already contains exactly them.
 * Creates parent directories. Returns true when the file was (re)written.
 */
export async function writeIfChanged(path: string, bytes: Uint8Array | string): Promise<boolean> {
  const next = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  const prev = await readFileOrNull(path);
  if (prev !== null && prev.equals(next)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  return true;
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
