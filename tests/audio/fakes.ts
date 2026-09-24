/**
 * Hand-written Web Audio + fetch fakes for the audio tests. No jsdom: only the
 * surface the audio module touches is modelled, and every call is recorded so
 * tests can assert on scheduling, connections and state transitions.
 */
import { vi } from 'vitest';

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`channel ${channel} out of range`);
    return data;
  }

  copyToChannel(source: Float32Array, channel: number, startInChannel = 0): void {
    this.getChannelData(channel).set(source, startInChannel);
  }
}

export class FakeGainNode {
  readonly gain = { value: 1 };
  readonly connections: unknown[] = [];

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

export class FakeBufferSource {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  /** `when` argument of start(); null until started. */
  startedAt: number | null = null;
  readonly startCalls: (number | undefined)[] = [];
  readonly stopCalls: (number | undefined)[] = [];
  readonly connections: unknown[] = [];
  disconnected = false;

  constructor(private readonly ctx: FakeAudioContext) {}

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  start(when?: number): void {
    if (this.startedAt !== null) throw new Error('InvalidStateError: start() called twice');
    this.startedAt = when ?? this.ctx.currentTime;
    this.startCalls.push(when);
  }

  stop(when?: number): void {
    if (this.startedAt === null) throw new Error('InvalidStateError: stop() before start()');
    this.stopCalls.push(when);
    // Browsers dispatch `ended` asynchronously after stop() takes effect.
    queueMicrotask(() => this.fireEnded());
  }

  /** Simulate the buffer running out. */
  fireEnded(): void {
    this.onended?.();
  }
}

export interface FakeOutputTimestamp {
  contextTime?: number;
  performanceTime?: number;
}

export interface FakeContextOptions {
  /** Define getOutputTimestamp(); omit to model a browser without it. */
  outputTimestamp?: boolean;
  sampleRate?: number;
  decode?: (bytes: ArrayBuffer) => Promise<FakeAudioBuffer>;
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate: number;
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'running';
  readonly destination = { node: 'destination' };

  readonly sources: FakeBufferSource[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  readonly decodeCalls: ArrayBuffer[] = [];
  suspendCalls = 0;
  resumeCalls = 0;

  /** What getOutputTimestamp() returns (when defined). */
  outputTimestamp: FakeOutputTimestamp = {};
  getOutputTimestamp?: () => FakeOutputTimestamp;

  private readonly decode: (bytes: ArrayBuffer) => Promise<FakeAudioBuffer>;

  constructor(opts: FakeContextOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.decode = opts.decode ?? ((bytes) => decodeTagged(bytes, this.sampleRate));
    if (opts.outputTimestamp) {
      this.getOutputTimestamp = () => ({ ...this.outputTimestamp });
    }
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource(this);
    this.sources.push(source);
    return source;
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<FakeAudioBuffer> {
    this.decodeCalls.push(bytes);
    return this.decode(bytes);
  }

  async suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }

  get lastSource(): FakeBufferSource {
    const source = this.sources[this.sources.length - 1];
    if (!source) throw new Error('no BufferSource has been created');
    return source;
  }

  get lastGain(): FakeGainNode {
    const gain = this.gains[this.gains.length - 1];
    if (!gain) throw new Error('no GainNode has been created');
    return gain;
  }

  /** Cast for passing into the module under test. */
  asReal(): AudioContext {
    return this as unknown as AudioContext;
  }
}

// ─── fetch + decode wiring ───────────────────────────────────────────────────
//
// Fake responses carry a text tag as their body. `ok:<seconds>` decodes to a
// buffer of that duration; anything else fails to decode, like a file the
// browser has no codec for.

export function encodeTag(tag: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(tag);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function decodeTagged(bytes: ArrayBuffer, sampleRate = 48000): Promise<FakeAudioBuffer> {
  const tag = new TextDecoder().decode(bytes);
  const match = /^ok:(\d+(?:\.\d+)?)$/.exec(tag);
  if (!match) throw new Error(`EncodingError: unable to decode audio data (${JSON.stringify(tag)})`);
  const seconds = Number(match[1]);
  return new FakeAudioBuffer(2, Math.round(seconds * sampleRate), sampleRate);
}

export interface FakeRoute {
  /** HTTP status, default 200. */
  status?: number;
  /** Body tag, see decodeTagged(). Default '' (undecodable). */
  body?: string;
  /** Reject the fetch itself (network failure). */
  throws?: boolean;
}

export function makeFetch(routes: Record<string, FakeRoute>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes[url];
    if (!route) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (route.throws) throw new TypeError('Failed to fetch');
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => encodeTag(route.body ?? ''),
    };
  });
  return { fetch: fetchImpl, calls };
}

/** Let queued microtasks and a macrotask turn run (ended events, etc.). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
