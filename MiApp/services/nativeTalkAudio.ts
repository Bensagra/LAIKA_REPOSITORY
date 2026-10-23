// `* as` rather than named imports: react-native-web (what 'react-native'
// resolves to on web) doesn't export PermissionsAndroid at all, which would
// otherwise fail the web build even though this path never actually runs
// there (services/go2Talk.ts only calls into this file off Platform.OS).
import * as ReactNative from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';

const { Platform } = ReactNative;

// Native (non-web) audio sources for services/go2Talk.ts's TalkClient. The
// web path captures mic audio via an AudioWorklet and resamples it to this
// same format in JS (see WORKLET_SOURCE there) — these produce the identical
// wire format (640-sample / 1280-byte PCM16LE mono chunks @ 16kHz) so the
// rest of TalkClient (WS protocol, rate-limited send queue) doesn't need to
// know which platform it's running on.
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 640;
const CHUNK_BYTES = CHUNK_SAMPLES * 2;
const CHUNK_MS = (CHUNK_SAMPLES / SAMPLE_RATE) * 1000;

type ChunkHandler = (buffer: ArrayBuffer) => void;

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS prompts automatically on first getUserMedia-equivalent access.
  const PermissionsAndroid = (ReactNative as any).PermissionsAndroid;
  if (!PermissionsAndroid) return false;
  try {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Permiso de micrófono',
      message: 'LAIKA necesita el micrófono para hablar por el parlante del robot.',
      buttonPositive: 'Permitir',
      buttonNegative: 'Cancelar',
    });
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// react-native-live-audio-stream hands PCM chunks over the RN bridge as
// base64 strings (no native base64 decoder is guaranteed to exist in the JS
// runtime — Hermes has no `atob` — so this decodes by hand).
function base64ToBytes(base64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = base64.replace(/=+$/, '');
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = i + 2 < len ? lookup[clean.charCodeAt(i + 2)] : 0;
    const dBit = i + 3 < len ? lookup[clean.charCodeAt(i + 3)] : 0;
    out[p++] = (a << 2) | (b >> 4);
    if (i + 2 < len) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < len) out[p++] = ((c & 3) << 6) | dBit;
  }
  return out;
}

/** Real mic capture, re-chunked to fixed 640-sample PCM16LE pieces. */
export class NativeMicSource {
  private readonly onChunk: ChunkHandler;
  private carry: number[] = [];
  private listener: { remove: () => void } | null = null;
  private running = false;

  constructor(onChunk: ChunkHandler) {
    this.onChunk = onChunk;
  }

  async start(): Promise<void> {
    const granted = await requestMicPermission();
    if (!granted) throw new Error('Permiso de micrófono denegado');

    LiveAudioStream.init({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6, // Android VOICE_RECOGNITION: less aggressive auto-gain/noise processing than the default mic source.
      bufferSize: CHUNK_BYTES,
      wavFile: 'laika_talk_stream.wav', // required by the library; the file itself isn't used, only the live 'data' events.
    });
    this.running = true;
    // The library's own .d.ts mistypes `on()` as returning void; its actual
    // implementation returns the NativeEventEmitter subscription.
    this.listener = LiveAudioStream.on('data', (base64: string) => this.handleData(base64)) as unknown as { remove: () => void };
    LiveAudioStream.start();
  }

  private handleData(base64: string) {
    if (!this.running) return;
    const bytes = base64ToBytes(base64);
    for (let i = 0; i < bytes.length; i++) this.carry.push(bytes[i]);
    // The native buffer size isn't guaranteed to land exactly on our chunk
    // boundary, so re-slice into fixed pieces instead of forwarding as-is.
    while (this.carry.length >= CHUNK_BYTES) {
      const piece = this.carry.splice(0, CHUNK_BYTES);
      this.onChunk(new Uint8Array(piece).buffer);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    try { LiveAudioStream.stop(); } catch {}
    this.listener?.remove();
    this.listener = null;
    this.carry = [];
  }
}

/** Synthetic siren, generated sample-by-sample in JS — a sawtooth swept
 * 650-1550Hz by a slow triangle LFO and one-pole-lowpassed, matching
 * go2Talk.ts's browser AudioWorklet siren closely enough to sound the same,
 * with no microphone or native audio capture involved at all. */
export class SirenSource {
  private readonly onChunk: ChunkHandler;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tonePhase = 0;
  private sweepPhase = 0;
  private filtered = 0;

  constructor(onChunk: ChunkHandler) {
    this.onChunk = onChunk;
  }

  start(): void {
    // One-pole RC lowpass, ~3200Hz cutoff at 16kHz — a cheap stand-in for the
    // web version's BiquadFilterNode, just to round off the sawtooth's edges.
    const alpha = (1 / SAMPLE_RATE) / (1 / (2 * Math.PI * 3200) + 1 / SAMPLE_RATE);
    this.timer = setInterval(() => {
      const pcm = new Int16Array(CHUNK_SAMPLES);
      for (let i = 0; i < CHUNK_SAMPLES; i++) {
        this.sweepPhase = (this.sweepPhase + 0.7 / SAMPLE_RATE) % 1;
        const sweep = Math.abs(this.sweepPhase * 4 - 2) - 1; // triangle LFO, -1..1
        const freq = 1100 + 450 * sweep;
        this.tonePhase = (this.tonePhase + freq / SAMPLE_RATE) % 1;
        const raw = 2 * this.tonePhase - 1; // sawtooth, -1..1
        this.filtered += alpha * (raw - this.filtered);
        const sample = Math.max(-1, Math.min(1, this.filtered * 0.55));
        pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      this.onChunk(pcm.buffer);
    }, CHUNK_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.tonePhase = 0;
    this.sweepPhase = 0;
    this.filtered = 0;
  }
}
