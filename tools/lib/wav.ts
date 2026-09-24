/**
 * Minimal PCM WAV writer/reader (RIFF, 16-bit signed, little-endian).
 * The reader is only used by tests and by build sanity checks.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Frames (samples per channel). */
  frames: number;
  dataOffset: number;
  dataBytes: number;
}

const HEADER_BYTES = 44;

/**
 * Encode interleaved float samples in [-1, 1] as 16-bit PCM.
 * `channels` planar Float64Arrays of equal length are interleaved here.
 */
export function encodeWav16(channels: readonly Float64Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  if (channelCount < 1) throw new Error('encodeWav16: at least one channel is required');
  const frames = channels[0]!.length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('encodeWav16: channels must have equal length');
  }
  const blockAlign = channelCount * 2;
  const dataBytes = frames * blockAlign;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let p = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const x = channels[c]![i]!;
      const clamped = x > 1 ? 1 : x < -1 ? -1 : x;
      view.setInt16(p, Math.round(clamped * 32767), true);
      p += 2;
    }
  }
  return out;
}

/** Parse the RIFF header of a WAV produced by encodeWav16 (or any canonical PCM WAV). */
export function readWavInfo(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let p = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  while (p + 8 <= bytes.length) {
    const id = tag(p);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      const blockAlign = fmt.channels * (fmt.bitsPerSample / 8);
      return { ...fmt, frames: Math.floor(size / blockAlign), dataOffset: body, dataBytes: size };
    }
    p = body + size + (size % 2);
  }
  throw new Error('no data chunk');
}
