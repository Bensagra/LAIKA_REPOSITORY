// Web-only: photo/video capture from a live <canvas> feed (camera, thermal,
// night). Adapted from a reference vanilla-JS implementation for a different
// (non-React Native) dashboard — same core idea (own fixed-size recording
// canvas, since the source canvas can change resolution mid-stream when the
// network profile changes, which breaks the recording in some browsers if
// you captureStream() the live canvas directly), re-expressed as a plain TS
// class instead of copying its code, and driven by requestAnimationFrame
// instead of hooking into each draw call (this app's frame-to-canvas drawing
// lives inside services/robotSocket.ts, not in the screen's own render loop).

const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickVideoType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function captureCanvasPhoto(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Sin imagen de cámara'))), 'image/png');
  });
}

export function downloadBlobLocally(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export interface CanvasRecorderOptions {
  fps?: number;
  videoBitsPerSecond?: number;
  maxSeconds?: number;
  maxBytes?: number;
  onTick?: (seconds: number, bytes: number) => void;
}

interface RecorderRun {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  media: MediaStream;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  bytes: number;
  startedAt: number;
  stopping: boolean;
  rafId: number;
  timer: ReturnType<typeof setTimeout>;
  ticker: ReturnType<typeof setInterval>;
}

/** Records a live <canvas> into a clip of fixed size/duration, regardless of
 * the source canvas resizing mid-recording (network-profile changes, feed
 * switches, etc). One instance per capture — not reused across clips. */
export class CanvasRecorder {
  private readonly source: HTMLCanvasElement;
  private readonly opts: Required<Omit<CanvasRecorderOptions, 'onTick'>> & Pick<CanvasRecorderOptions, 'onTick'>;
  private run: RecorderRun | null = null;

  constructor(source: HTMLCanvasElement, opts: CanvasRecorderOptions = {}) {
    this.source = source;
    this.opts = {
      fps: opts.fps ?? 15,
      videoBitsPerSecond: opts.videoBitsPerSecond ?? 2_500_000,
      maxSeconds: opts.maxSeconds ?? 300,
      maxBytes: opts.maxBytes ?? 300 * 1024 * 1024,
      onTick: opts.onTick,
    };
  }

  get active(): boolean {
    return this.run !== null;
  }

  start(): void {
    if (this.run) return;
    if (typeof MediaRecorder !== 'function') throw new Error('Este navegador no puede grabar video');
    const width = this.source.width;
    const height = this.source.height;
    if (!width || !height) throw new Error('La cámara todavía no mostró imagen');

    const canvas = document.createElement('canvas');
    canvas.width = width - (width % 2); // H.264 wants even dimensions
    canvas.height = height - (height % 2);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No se pudo preparar el canvas de grabación');
    const media = (canvas as unknown as { captureStream(fps: number): MediaStream }).captureStream(this.opts.fps);
    const mimeType = pickVideoType();

    const run: RecorderRun = {
      canvas, ctx, media, chunks: [], bytes: 0, startedAt: Date.now(), stopping: false,
      recorder: new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: this.opts.videoBitsPerSecond }),
      rafId: 0,
      timer: setTimeout(() => this.stop(), this.opts.maxSeconds * 1000),
      ticker: setInterval(() => this.run && this.opts.onTick?.(this.seconds(), this.run.bytes), 1000),
    };
    run.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      run.chunks.push(e.data);
      run.bytes += e.data.size;
      if (run.bytes > this.opts.maxBytes) this.stop();
    };
    run.recorder.onerror = () => this.stop();
    run.recorder.start(1000);

    this.run = run;

    const copyFrame = () => {
      if (!this.run || this.run.stopping) return;
      const sw = this.source.width;
      const sh = this.source.height;
      if (sw && sh) {
        const scale = Math.min(canvas.width / sw, canvas.height / sh);
        const w = sw * scale;
        const h = sh * scale;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this.source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      }
      this.run.rafId = requestAnimationFrame(copyFrame);
    };
    run.rafId = requestAnimationFrame(copyFrame);
  }

  private seconds(): number {
    return this.run ? Math.round((Date.now() - this.run.startedAt) / 1000) : 0;
  }

  /** Resolves with the finished clip, or null if nothing was captured. */
  stop(): Promise<{ blob: Blob; durationMs: number } | null> {
    const run = this.run;
    if (!run || run.stopping) return Promise.resolve(null);
    run.stopping = true;
    cancelAnimationFrame(run.rafId);
    clearTimeout(run.timer);
    clearInterval(run.ticker);
    return new Promise((resolve) => {
      const finish = () => {
        this.run = null;
        run.media.getTracks().forEach((track) => track.stop());
        const type = run.recorder.mimeType || 'video/webm';
        const blob = new Blob(run.chunks, { type });
        const durationMs = Date.now() - run.startedAt;
        resolve(blob.size ? { blob, durationMs } : null);
      };
      if (run.recorder.state === 'inactive') finish();
      else {
        run.recorder.onstop = finish;
        run.recorder.stop();
      }
    });
  }
}
