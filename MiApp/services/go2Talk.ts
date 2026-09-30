import { Platform } from 'react-native';
import { DOG_API_URL, DOG_ROBOT_ID, DOG_TOKEN, warnIfMixedContent } from './api';

// Handy: browser mic -> PCM16 mono 16kHz -> wss://.../ws/talk/{robot_id} -> edge
// -> Go2 speaker. Exclusive per robot, 20s max turn, server/edge also enforce
// the cutoffs described below; this client just needs to hold its own.

export type TalkStatusMessage =
  | { status: 'opening' }
  | { status: 'talking'; remaining: number }
  | { status: 'stopped' }
  | { status: 'error'; error: string };

export type TalkStatusCallback = (message: TalkStatusMessage) => void;

export interface TalkConnection {
  apiBase?: string;
  token?: string;
  robotId?: string;
}

const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 640; // 40ms @ 16kHz = 1280 bytes
const MAX_BUFFERED_BYTES = 6400; // ~200ms of PCM16; past this the link is too slow
const DEFAULT_MAX_SECONDS = 20;

const WS_CLOSE_REASONS: Record<number, string> = {
  4401: 'Token inválido o ausente',
  4403: 'No tenés permiso para hablar por el robot',
  4409: 'Otro operador ya está usando el parlante',
  4410: 'El robot no está disponible en este momento',
};

// Runs inside an AudioWorkletProcessor (its own realtime thread): downmixes
// to mono, resamples to 16kHz with linear interpolation and emits fixed
// 640-sample PCM16 LE chunks over the worklet port. Loaded from a Blob URL
// since this project has no bundler step for separate worklet modules.
const WORKLET_SOURCE = `
class Go2TalkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = ${SAMPLE_RATE} / sampleRate; // output samples per input sample
    this.buffer = [];
    this.readPos = 0;
    this.outAcc = [];
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length && input[0].length) {
      const channels = input.length;
      const length = input[0].length;
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i];
        this.buffer.push(sum / channels);
      }
      const step = 1 / this.ratio;
      while (this.readPos + 1 < this.buffer.length) {
        const i0 = Math.floor(this.readPos);
        const i1 = i0 + 1;
        const frac = this.readPos - i0;
        const sample = this.buffer[i0] + (this.buffer[i1] - this.buffer[i0]) * frac;
        this.outAcc.push(sample);
        this.readPos += step;
      }
      const consumed = Math.floor(this.readPos);
      if (consumed > 0) {
        this.buffer = this.buffer.slice(consumed);
        this.readPos -= consumed;
      }
      while (this.outAcc.length >= ${CHUNK_SAMPLES}) {
        const chunk = this.outAcc.splice(0, ${CHUNK_SAMPLES});
        const pcm = new Int16Array(${CHUNK_SAMPLES});
        for (let i = 0; i < ${CHUNK_SAMPLES}; i++) {
          const s = Math.max(-1, Math.min(1, chunk[i]));
          pcm[i] = s < 0 ? s * 32768 : s * 32767;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('go2-talk-processor', Go2TalkProcessor);
`;

export class TalkClient {
  private readonly onStatus: TalkStatusCallback;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private stream: MediaStream | null = null;
  private workletUrl: string | null = null;
  private maxSeconds = DEFAULT_MAX_SECONDS;
  private startedAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  // Chunks from the worklet are queued, never sent straight from its
  // onmessage handler: this screen's main thread (LiDAR/video rendering,
  // the drive loop) can stall for a while and then process several queued
  // postMessages back-to-back, which would burst-send PCM and trip the
  // server's real-time rate limit even though the long-run average is fine.
  // sendTimer drains at most one 40ms chunk per tick, so a stall just delays
  // audio instead of bursting it; outgoingQueue is capped so a long stall
  // drops old audio rather than queuing it up to dump later.
  private outgoingQueue: ArrayBuffer[] = [];
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private opening = false;
  private stopped = true;
  private listenersAttached = false;

  constructor(onStatus: TalkStatusCallback) {
    this.onStatus = onStatus;
    this.handleBlur = this.handleBlur.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);
  }

  /** True while opening or actively transmitting this turn. */
  get active(): boolean {
    return this.opening || !this.stopped;
  }

  async start(connection: TalkConnection = {}): Promise<void> {
    if (Platform.OS !== 'web') {
      throw new Error('El micrófono solo está disponible en la web');
    }
    if (this.active) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite acceder al micrófono');
    }
    const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('Este navegador no soporta AudioContext');
    }

    const apiBase = connection.apiBase ?? DOG_API_URL;
    const token = connection.token ?? DOG_TOKEN;
    const robotId = connection.robotId ?? DOG_ROBOT_ID;

    this.opening = true;
    this.stopped = false;
    this.onStatus({ status: 'opening' });

    try {
      await this.openSocket(apiBase, token, robotId);
      await this.openMicrophone(AudioContextCtor);
      this.attachGlobalListeners();
      this.startedAt = Date.now();
      this.opening = false;
      this.tick();
      this.tickTimer = setInterval(() => this.tick(), 1000);
      this.sendTimer = setInterval(() => this.drainOneChunk(), CHUNK_SAMPLES / SAMPLE_RATE * 1000);
    } catch (err) {
      this.cleanup();
      throw err instanceof Error ? err : new Error('No se pudo abrir el micrófono');
    }
  }

  /** Ends this turn (user action, timeout, or an external stop). Safe to call repeatedly. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.opening = false;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'stop' })); } catch {}
    }
    this.cleanup();
    this.onStatus({ status: 'stopped' });
  }

  /** Stop + drop the global listeners; call when the owning view unmounts. */
  dispose(): void {
    this.stop();
    this.detachGlobalListeners();
  }

  private tick() {
    if (this.stopped) return;
    const elapsed = (Date.now() - this.startedAt) / 1000;
    const remaining = Math.max(0, Math.ceil(this.maxSeconds - elapsed));
    if (remaining <= 0) {
      this.stop();
      return;
    }
    this.onStatus({ status: 'talking', remaining });
  }

  private openSocket(apiBase: string, token: string, robotId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const base = apiBase.replace(/^http/, 'ws').replace(/\/$/, '');
      const url = `${base}/ws/talk/${encodeURIComponent(robotId)}?token=${encodeURIComponent(token)}`;
      warnIfMixedContent(url);
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        reject(new Error('No se pudo abrir la conexión de voz'));
        return;
      }
      this.ws = socket;

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (!settled) {
          if (msg?.status === 'ready') {
            settled = true;
            this.maxSeconds = Number(msg.max_seconds) > 0 ? Number(msg.max_seconds) : DEFAULT_MAX_SECONDS;
            resolve();
          } else if (msg?.status === 'error') {
            settled = true;
            reject(new Error(String(msg.error || 'El robot rechazó la sesión de voz')));
          }
          return;
        }

        if (msg?.status === 'stopped') {
          this.finish();
        } else if (msg?.status === 'error') {
          this.fail(String(msg.error || 'Error en la sesión de voz'));
        }
      };

      socket.onclose = (event) => {
        if (!settled) {
          settled = true;
          reject(new Error(WS_CLOSE_REASONS[event.code] || 'No se pudo abrir el micrófono'));
          return;
        }
        if (!this.stopped) this.fail('Se perdió la conexión de voz');
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('No se pudo conectar con el robot'));
        }
      };
    });
  }

  private async openMicrophone(AudioContextCtor: any): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const audioContext: AudioContext = new AudioContextCtor();
    this.audioContext = audioContext;

    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    this.workletUrl = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(this.workletUrl);

    const workletNode = new AudioWorkletNode(audioContext, 'go2-talk-processor');
    this.workletNode = workletNode;
    workletNode.port.onmessage = (event) => this.enqueueChunk(event.data as ArrayBuffer);

    const sourceNode = audioContext.createMediaStreamSource(this.stream);
    this.sourceNode = sourceNode;
    sourceNode.connect(workletNode);

    // A worklet node only gets pulled for processing while its output chain
    // reaches the destination; route it through a muted gain so it keeps
    // running without playing the mic back locally (no echo).
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    this.silentGain = silentGain;
    workletNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {});
    }
  }

  private enqueueChunk(buffer: ArrayBuffer) {
    if (this.stopped) return;
    this.outgoingQueue.push(buffer);
    // ~400ms of backlog; if the main thread stalls longer than that, drop
    // the oldest audio instead of piling it up for a later burst.
    while (this.outgoingQueue.length > 10) this.outgoingQueue.shift();
  }

  private drainOneChunk() {
    if (this.stopped) return;
    const buffer = this.outgoingQueue.shift();
    if (!buffer) return;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.fail('La red es demasiado lenta para transmitir voz');
      return;
    }
    ws.send(buffer);
  }

  private finish() {
    if (this.stopped) return;
    this.stopped = true;
    this.opening = false;
    this.cleanup();
    this.onStatus({ status: 'stopped' });
  }

  private fail(error: string) {
    if (this.stopped) return;
    this.stopped = true;
    this.opening = false;
    this.cleanup();
    this.onStatus({ status: 'error', error });
  }

  private cleanup() {
    this.detachGlobalListeners();
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null; }
    this.outgoingQueue = [];
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }
    if (this.silentGain) {
      try { this.silentGain.disconnect(); } catch {}
      this.silentGain = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
  }

  private handleBlur() { this.stop(); }
  private handleVisibility() { if (document.hidden) this.stop(); }
  private handlePageHide() { this.stop(); }

  private attachGlobalListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('pagehide', this.handlePageHide);
  }

  private detachGlobalListeners() {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('pagehide', this.handlePageHide);
  }
}
