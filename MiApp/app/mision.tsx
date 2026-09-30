import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Circle } from 'react-native-svg';

import { styles, BAR_BUTTON, BAR_GAP, BAR_PAD, BAR_WIDTH, JOY_KNOB, JOY_SIZE } from '../styles/misionStyles';
import { C, formatClock, levelColor } from '../styles/theme';
import { d } from '../utils/scale';
import { useAppSettings } from '../contexts/AppSettings';
import { useDeviceBattery } from '../utils/device';
import Icon, { IconName, WifiIcon } from '../components/Icons';
import LidarReconstruction, { LidarSink, LidarSinkFrame } from '../components/LidarReconstruction';
import {
  DOG_API_URL,
  DOG_ROBOT_ID,
  DOG_TOKEN,
  emergencyStop,
  getRobotStatus,
  moveRobotAxes,
  RobotStatus,
} from '../services/api';
import { TalkClient, TalkStatusMessage } from '../services/go2Talk';
import { configureDogMedia, DEFAULT_SPEED_PROFILES, NETWORK_PROFILES } from '../services/operator';
import { stopServerMission } from '../services/missions';
import {
  connectRobotWS,
  registerThermalCanvas,
  registerVideoCanvas,
  sendConfirmedCommand,
  sendRobotDrive,
  sendRobotDriveStop,
  sendRobotHeartbeat,
  ThermalFrameMeta,
} from '../services/robotSocket';

const CAPTURE_MAX_AGE_MS = 3000;

// Mission screen (PDF pages 5, 6, 9, 10–12, 17, 18).

type FeedKey = 'camera' | 'thermal' | 'lidar' | 'night';
const FEEDS: { key: FeedKey; label: string }[] = [
  { key: 'camera', label: 'Normal' },
  { key: 'thermal', label: 'Térmica' },
  { key: 'lidar', label: 'LiDAR' },
  { key: 'night', label: 'Nocturna' },
];

type Posture = 'parado' | 'agachado';
type ToastState = { text: string; ok: boolean } | null;

const TOAST_MS = 1500;
const PHOTO_HIGHLIGHT_MS = 2000;
const FEED_LABEL_MS = 1500;
const THERMAL_STALE_MS = 3000;
const SWIPE_MIN_PX = 50;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const formatShort = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// Connection quality 0–100 for the status bar: link up, fresh data and a
// quick robot API round trip. Same colour thresholds as the batteries.
function connectionScore(connected: boolean, lastDataAgeMs: number, rttMs: number | null) {
  if (!connected) return 0;
  let score = rttMs == null ? 70 : rttMs < 250 ? 100 : rttMs < 600 ? 55 : 25;
  if (lastDataAgeMs > 5000) score = Math.min(score, 25);
  else if (lastDataAgeMs > 2000) score = Math.min(score, 55);
  return score;
}

// ── Feeds ───────────────────────────────────────────────────────────────────

const CameraFeed = ({ uri, hasFrames }: { uri: string | null; hasFrames: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;
    return registerVideoCanvas(canvasRef.current);
  }, []);
  return (
    <View style={styles.feed}>
      {Platform.OS === 'web'
        ? React.createElement('canvas', {
          ref: canvasRef,
          id: 'laika-camera-canvas',
          style: {
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            // Until frames arrive, the design's grey placeholder shows through.
            backgroundColor: hasFrames ? '#000' : 'transparent',
          },
        })
        : uri && <Image source={{ uri }} style={styles.feedImage} resizeMode="cover" />}
    </View>
  );
};

const ThermalFeed = ({ meta, stale, hasFrames }: { meta: ThermalFrameMeta | null; stale: boolean; hasFrames: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;
    return registerThermalCanvas(canvasRef.current);
  }, []);
  const t = meta?.temperature;
  const fmt = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}°` : '--');
  return (
    <View style={styles.feed}>
      {Platform.OS === 'web' && React.createElement('canvas', {
        ref: canvasRef,
        style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: stale ? 0.35 : 1 },
      })}
      {(!hasFrames || stale) && <Text style={styles.feedEmptyText}>{hasFrames ? 'SEÑAL INTERRUMPIDA' : 'SIN SEÑAL'}</Text>}
      {hasFrames && !stale && (
        <Text style={styles.thermalReadout}>mín {fmt(t?.min_c)} · máx {fmt(t?.max_c)} · centro {fmt(t?.center_c)}</Text>
      )}
    </View>
  );
};

// Native has no WebGL map here: a top-down point view instead.
const LidarMapView = ({ points, count }: { points: Float32Array | null; count: number }) => {
  const W = 220, H = 160, PAD = 6;
  const dots = React.useMemo(() => {
    if (!points || !count) return [];
    const step = Math.max(1, Math.ceil(count / 350));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i += step) {
      const x = points[i * 3], y = points[i * 3 + 1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const rx = (maxX - minX) || 1, ry = (maxY - minY) || 1;
    const out: { cx: number; cy: number }[] = [];
    for (let i = 0; i < count; i += step) {
      out.push({ cx: PAD + ((points[i * 3] - minX) / rx) * (W - 2 * PAD), cy: PAD + ((points[i * 3 + 1] - minY) / ry) * (H - 2 * PAD) });
    }
    return out;
  }, [points, count]);
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      {dots.map((p, i) => <Circle key={i} cx={p.cx} cy={p.cy} r={1.2} fill="#00e676" opacity={0.85} />)}
    </Svg>
  );
};

// ── Joysticks / arrows ──────────────────────────────────────────────────────

const joystickState = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };

function Joystick({ which, label, chevrons }: { which: 'left' | 'right'; label: string; chevrons: boolean }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const max = (JOY_SIZE - JOY_KNOB) / 2;
  const release = useCallback(() => {
    setPos({ x: 0, y: 0 });
    joystickState[which] = { x: 0, y: 0 };
  }, [which]);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, { dx, dy }) => {
      const dist = Math.hypot(dx, dy);
      const r = dist > max ? max / dist : 1;
      const next = { x: dx * r, y: dy * r };
      setPos(next);
      joystickState[which] = { x: next.x / max, y: next.y / max };
    },
    onPanResponderRelease: release,
    onPanResponderTerminate: release,
  })).current;

  return (
    <View style={styles.joyColumn}>
      <Text style={styles.joyLabel}>{label}</Text>
      <View style={styles.joyBase} {...pan.panHandlers}>
        {chevrons && (
          <>
            <View style={[styles.chevron, styles.chevronTop]} pointerEvents="none"><Icon name="chevronUp" size={d(16)} color={C.textFaint} strokeWidth={2.4} /></View>
            <View style={[styles.chevron, styles.chevronBottom]} pointerEvents="none"><Icon name="chevronDown" size={d(16)} color={C.textFaint} strokeWidth={2.4} /></View>
            <View style={[styles.chevron, styles.chevronLeft]} pointerEvents="none"><Icon name="chevronLeft" size={d(16)} color={C.textFaint} strokeWidth={2.4} /></View>
            <View style={[styles.chevron, styles.chevronRight]} pointerEvents="none"><Icon name="chevronRight" size={d(16)} color={C.textFaint} strokeWidth={2.4} /></View>
          </>
        )}
        <View style={[styles.joyKnob, { transform: [{ translateX: pos.x }, { translateY: pos.y }] }]} pointerEvents="none" />
      </View>
    </View>
  );
}

// Arrow mode (joystick off in settings): hold an arrow to move/rotate.
function ArrowPad({ which, label }: { which: 'left' | 'right'; label: string }) {
  const hold = (x: number, y: number) => ({
    onPressIn: () => { joystickState[which] = { x, y }; },
    onPressOut: () => { joystickState[which] = { x: 0, y: 0 }; },
  });
  const arrows: { icon: IconName; style: object; x: number; y: number }[] = which === 'left'
    ? [
      { icon: 'chevronUp', style: styles.arrowTop, x: 0, y: -1 },
      { icon: 'chevronDown', style: styles.arrowBottom, x: 0, y: 1 },
      { icon: 'chevronLeft', style: styles.arrowLeft, x: -1, y: 0 },
      { icon: 'chevronRight', style: styles.arrowRight, x: 1, y: 0 },
    ]
    : [
      { icon: 'chevronLeft', style: styles.arrowLeft, x: -1, y: 0 },
      { icon: 'chevronRight', style: styles.arrowRight, x: 1, y: 0 },
    ];
  return (
    <View style={styles.joyColumn}>
      <Text style={styles.joyLabel}>{label}</Text>
      <View style={styles.joyBase}>
        {arrows.map((a) => (
          <Pressable key={a.icon} {...hold(a.x, a.y)} style={({ pressed }) => [styles.arrowButton, a.style, pressed && styles.arrowButtonPressed]}>
            <Icon name={a.icon} size={d(22)} strokeWidth={2.8} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── Status chips over the action bar (page 17) ──────────────────────────────

const CHIP_GAP = d(6);

/**
 * Left offsets (relative to the bar) for the active chips (page 17):
 * - one chip sits centred over its own button;
 * - two or three form a row centred on the bar: same margin on both sides and
 *   the same gap between chips.
 */
function layoutChips(chips: { buttonIndex: number; width: number }[]): number[] {
  if (chips.length === 1) {
    const { buttonIndex, width } = chips[0];
    const center = BAR_PAD + buttonIndex * (BAR_BUTTON + BAR_GAP) + BAR_BUTTON / 2;
    return [Math.min(Math.max(center - width / 2, 0), BAR_WIDTH - width)];
  }
  const total = chips.reduce((sum, c) => sum + c.width, 0) + CHIP_GAP * (chips.length - 1);
  let left = (BAR_WIDTH - total) / 2;
  return chips.map(({ width }) => {
    const at = left;
    left += width + CHIP_GAP;
    return at;
  });
}

function ActionChips({ actions }: { actions: { key: string; chip?: string; active: boolean }[] }) {
  // Real widths come from layout; start from an estimate so the first frame
  // is already close.
  const [widths, setWidths] = useState<Record<string, number>>({});
  const active = actions
    .map((a, buttonIndex) => ({ ...a, buttonIndex }))
    .filter((a) => a.chip && a.active);
  const estimate = (text: string) => text.length * d(5.4) + d(18);
  const lefts = layoutChips(active.map((a) => ({ buttonIndex: a.buttonIndex, width: widths[a.key] ?? estimate(a.chip!) })));
  return (
    <View style={styles.chipsRow} pointerEvents="none">
      {active.map((a, i) => (
        <View
          key={a.key}
          style={[styles.chip, { left: lefts[i] }]}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setWidths((prev) => (Math.abs((prev[a.key] ?? 0) - w) < 0.5 ? prev : { ...prev, [a.key]: w }));
          }}
        >
          <Text style={styles.chipText} numberOfLines={1}>{a.chip}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function MisionScreen() {
  const router = useRouter();
  const { joystickEnabled, misionActiva, setMisionActiva, robotSpeed, videoResolution, lidarMaxPoints } = useAppSettings();
  const startedAt = useRef(misionActiva?.startedAt ?? Date.now()).current;
  const missionName = misionActiva?.nombre ?? 'Misión';

  const [now, setNow] = useState(Date.now());
  const [feedIndex, setFeedIndex] = useState(0);
  const [feedLabelVisible, setFeedLabelVisible] = useState(true);
  const [mediaConnected, setMediaConnected] = useState(false);
  const [cameraUri, setCameraUri] = useState<string | null>(null);
  const [cameraHasFrames, setCameraHasFrames] = useState(false);
  const [thermalMeta, setThermalMeta] = useState<ThermalFrameMeta | null>(null);
  const [thermalLastAt, setThermalLastAt] = useState(0);
  const [lidarData, setLidarData] = useState<{ points: Float32Array; count: number } | null>(null);
  const [telemetry, setTelemetry] = useState<Record<string, any> | null>(null);
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);

  const [talking, setTalking] = useState(false);
  const [talkRemaining, setTalkRemaining] = useState<number | null>(null);
  const [flashlight, setFlashlight] = useState(false);
  const [flashlightPending, setFlashlightPending] = useState(false);
  const [safetyEnabled, setSafetyEnabled] = useState(false);
  const [safetyPending, setSafetyPending] = useState(false);
  const [photoActive, setPhotoActive] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [postureOpen, setPostureOpen] = useState(false);
  const [posture, setPosture] = useState<Posture | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [exitVisible, setExitVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const phoneBattery = useDeviceBattery();
  const lidarSinkRef = useRef<LidarSink | null>(null);
  const lastDataAtRef = useRef(0);
  const lastTelemetryUiRef = useRef(0);
  const lastLidarUiRef = useRef(0);
  const lastThermalUiRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const flashlightPendingRef = useRef(false);
  const safetyPendingRef = useRef(false);
  const talkClientRef = useRef<TalkClient | null>(null);
  const keyStateRef = useRef<Set<string>>(new Set());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingDoneRef = useRef<Promise<void> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedIndexRef = useRef(0);
  feedIndexRef.current = feedIndex;

  const showToast = useCallback((text: string, ok = true) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, ok });
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // Handy: one TalkClient per screen, torn down on unmount so the 20s turn
  // and the mic always get released.
  useEffect(() => {
    const client = new TalkClient((message: TalkStatusMessage) => {
      if (message.status === 'opening') {
        setTalking(true);
        setTalkRemaining(null);
      } else if (message.status === 'talking') {
        setTalking(true);
        setTalkRemaining(message.remaining);
      } else if (message.status === 'stopped') {
        setTalking(false);
        setTalkRemaining(null);
      } else {
        setTalking(false);
        setTalkRemaining(null);
        showToast(message.error, false);
      }
    });
    talkClientRef.current = client;
    return () => {
      client.dispose();
      talkClientRef.current = null;
    };
  }, [showToast]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    feedLabelTimerRef.current = setTimeout(() => setFeedLabelVisible(false), FEED_LABEL_MS);
    return () => {
      clearInterval(tick);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (feedLabelTimerRef.current) clearTimeout(feedLabelTimerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    };
  }, []);

  // ── Camera carousel ──
  const selectFeed = useCallback((index: number) => {
    const next = (index + FEEDS.length) % FEEDS.length;
    if (next === feedIndexRef.current) return;
    setFeedIndex(next);
    setFeedLabelVisible(true);
    if (feedLabelTimerRef.current) clearTimeout(feedLabelTimerRef.current);
    feedLabelTimerRef.current = setTimeout(() => setFeedLabelVisible(false), FEED_LABEL_MS);
  }, []);

  // Swipe anywhere on the view (except the LiDAR view, where dragging orbits
  // the 3D map: there, swipe on the dots or scroll).
  const swipeResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      FEEDS[feedIndexRef.current].key !== 'lidar' && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) >= SWIPE_MIN_PX) selectFeed(feedIndexRef.current + (g.dx < 0 ? 1 : -1));
    },
  })).current;

  const dotsResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) >= SWIPE_MIN_PX / 2) selectFeed(feedIndexRef.current + (g.dx < 0 ? 1 : -1));
    },
  })).current;

  // Mouse wheel / trackpad scroll (web). On the LiDAR view the wheel zooms.
  const stageRef = useRef<View | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = stageRef.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    let lastAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (FEEDS[feedIndexRef.current].key === 'lidar') return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 30 || Date.now() - lastAt < 450) return;
      lastAt = Date.now();
      selectFeed(feedIndexRef.current + (delta > 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, [selectFeed]);

  // ── Robot link ──
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const t0 = Date.now();
      try {
        const status = await getRobotStatus();
        if (!alive) return;
        setRobotStatus(status);
        setRttMs(Date.now() - t0);
      } catch {
        if (alive) setRttMs(null);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const mediaSettings = {
      video: true,
      lidar: true,
      audio: false,
      profile: 'weak' as const,
      cameraFps: NETWORK_PROFILES.weak.cameraFps,
      cameraQuality: NETWORK_PROFILES.weak.cameraQuality,
      cameraWidth: videoResolution,
      cameraBitrateKbps: NETWORK_PROFILES.weak.cameraBitrateKbps,
      lidarMaxPoints,
      audioEmitEvery: 2,
      audioMaxBytes: 24576,
    };
    const disconnect = connectRobotWS({
      onOpen: () => { configureDogMedia(mediaSettings).catch(() => {}); },
      onStatus: setMediaConnected,
      onNetBytes: () => { lastDataAtRef.current = Date.now(); },
      onVideoFrame: (uri, encodedAtMs) => {
        lastDataAtRef.current = Date.now();
        if (Platform.OS !== 'web') setCameraUri(uri);
        setCameraHasFrames(true);
        lastFrameAtRef.current = encodedAtMs ?? Date.now();
      },
      onVideoTick: (encodedAtMs) => {
        setCameraHasFrames(true);
        lastFrameAtRef.current = encodedAtMs ?? Date.now();
      },
      onTelemetry: (data) => {
        const t = Date.now();
        lastDataAtRef.current = t;
        const record = data as Record<string, any>;
        if (!flashlightPendingRef.current) {
          const brightness = record?.flashlight?.brightness;
          if (brightness != null) setFlashlight(Number(brightness) > 0);
        }
        if (!safetyPendingRef.current) {
          const enabled = record?.safety?.enabled;
          if (enabled != null) setSafetyEnabled(!!enabled);
        }
        if (t - lastTelemetryUiRef.current < 500) return;
        lastTelemetryUiRef.current = t;
        setTelemetry(record);
      },
      onLidar: (points, count, meta) => {
        // Every frame goes to the 3D map (deltas only carry new points).
        const header = meta?.header as Record<string, any> | undefined;
        const pose = header?.pose;
        const frame: LidarSinkFrame = {
          points,
          colors: meta?.colors ?? null,
          mode: String(header?.mode ?? 'delta'),
          pose: pose ? { x: Number(pose.x), y: Number(pose.y), yaw: Number(pose.yaw ?? 0) } : null,
          path: Array.isArray(header?.path) ? header!.path : null,
        };
        lidarSinkRef.current?.addFrame(frame);
        const t = Date.now();
        if (t - lastLidarUiRef.current < 400) return;
        lastLidarUiRef.current = t;
        setLidarData({ points, count });
      },
      onThermal: (meta) => {
        const t = Date.now();
        if (t - lastThermalUiRef.current < 300) return;
        lastThermalUiRef.current = t;
        setThermalMeta(meta);
        setThermalLastAt(t);
      },
    });
    return disconnect;
  }, [lidarMaxPoints, videoResolution]);

  useEffect(() => {
    if (!mediaConnected) return;
    const interval = setInterval(() => sendRobotHeartbeat(), 500);
    return () => clearInterval(interval);
  }, [mediaConnected]);

  // ── Driving: keyboard + joysticks/arrows, same loop as before ──
  useEffect(() => {
    const speed = (() => {
      const scale = robotSpeed / 100;
      const p = DEFAULT_SPEED_PROFILES.normal;
      return { forward: p.forward * scale, reverse: p.reverse * scale, lateral: p.lateral * scale, angular: p.angular * scale };
    })();
    const movementKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
      'KeyQ', 'KeyE', 'KeyZ', 'KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit6',
      'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad6',
    ]);
    const typingTarget = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.matches?.('input, textarea, select, [contenteditable="true"]');
    let wasActive = false;
    let httpDriveInFlight = false;

    const sendDrive = () => {
      const keys = keyStateRef.current;
      let x = 0, y = 0, z = 0;
      if (['KeyW', 'ArrowUp', 'Digit2', 'Numpad2'].some((k) => keys.has(k))) x += speed.forward;
      if (['KeyS', 'ArrowDown'].some((k) => keys.has(k))) x -= speed.reverse;
      if (['KeyA', 'ArrowLeft', 'Digit1', 'Digit4', 'Numpad1', 'Numpad4'].some((k) => keys.has(k))) z += speed.angular;
      if (['KeyD', 'ArrowRight', 'Digit3', 'Digit6', 'Numpad3', 'Numpad6'].some((k) => keys.has(k))) z -= speed.angular;
      if (['KeyQ', 'KeyZ'].some((k) => keys.has(k))) y += speed.lateral;
      if (['KeyE', 'KeyC'].some((k) => keys.has(k))) y -= speed.lateral;

      const jl = joystickState.left;
      const jr = joystickState.right;
      if (Math.abs(jl.y) > 0.12) x += -jl.y * (jl.y < 0 ? speed.forward : speed.reverse);
      if (Math.abs(jl.x) > 0.12) y += -jl.x * speed.lateral;
      if (Math.abs(jr.x) > 0.12) z += -jr.x * speed.angular;

      x = clamp(x, -speed.reverse, speed.forward);
      y = clamp(y, -speed.lateral, speed.lateral);
      z = clamp(z, -speed.angular, speed.angular);

      if (x || y || z) {
        if (!sendRobotDrive(x, y, z, 320) && !httpDriveInFlight) {
          httpDriveInFlight = true;
          moveRobotAxes(x, y, z, 320).catch(() => {}).finally(() => { httpDriveInFlight = false; });
        }
        wasActive = true;
      } else {
        if (wasActive) sendRobotDriveStop();
        wasActive = false;
      }
    };

    const loop = setInterval(sendDrive, 80);
    if (Platform.OS !== 'web') return () => clearInterval(loop);

    const down = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return;
      if (event.code === 'Space') {
        // Emergency stop stays on the keyboard (no on-screen STOP in the design).
        event.preventDefault();
        keyStateRef.current.clear();
        joystickState.left = { x: 0, y: 0 };
        joystickState.right = { x: 0, y: 0 };
        sendRobotDriveStop();
        emergencyStop().catch(() => {});
        return;
      }
      if (!movementKeys.has(event.code)) return;
      event.preventDefault();
      keyStateRef.current.add(event.code);
      sendDrive();
    };
    const up = (event: KeyboardEvent) => {
      if (!movementKeys.has(event.code)) return;
      event.preventDefault();
      keyStateRef.current.delete(event.code);
      sendDrive();
    };
    const blur = () => {
      keyStateRef.current.clear();
      sendRobotDriveStop();
      wasActive = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      clearInterval(loop);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [robotSpeed]);

  // ── Action bar ──
  const toggleTalk = async () => {
    const client = talkClientRef.current;
    if (!client) return;
    if (client.active) {
      client.stop();
      return;
    }
    try {
      await client.start({ apiBase: DOG_API_URL, token: DOG_TOKEN, robotId: DOG_ROBOT_ID });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo abrir el micrófono', false);
    }
  };

  const toggleLight = async () => {
    if (flashlightPendingRef.current) return;
    flashlightPendingRef.current = true;
    setFlashlightPending(true);
    const next = !flashlight;
    try {
      const result = await sendConfirmedCommand('set_flashlight', { brightness: next ? 10 : 0 });
      const enabled = !!result.enabled;
      setFlashlight(enabled);
      showToast(enabled ? 'Linterna encendida' : 'Linterna apagada');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo cambiar la linterna', false);
    } finally {
      flashlightPendingRef.current = false;
      setFlashlightPending(false);
    }
  };

  const toggleSafety = async () => {
    if (safetyPendingRef.current) return;
    safetyPendingRef.current = true;
    setSafetyPending(true);
    const next = !safetyEnabled;
    try {
      const result = await sendConfirmedCommand('set_safety', { enabled: next });
      const enabled = !!result.safety_enabled;
      setSafetyEnabled(enabled);
      showToast(enabled ? 'Antichoque activado' : 'Antichoque desactivado');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo cambiar el antichoque', false);
    } finally {
      safetyPendingRef.current = false;
      setSafetyPending(false);
    }
  };

  // The server already records camera.mp4 for the whole mission; this is
  // just a quick local snapshot for the operator, downloaded on the spot
  // (there is no local mission gallery to save it into anymore).
  const takePhoto = () => {
    if (photoActive || Platform.OS !== 'web') {
      if (Platform.OS !== 'web') showToast('Captura disponible en la web', false);
      return;
    }
    const canvas = document.getElementById('laika-camera-canvas') as HTMLCanvasElement | null;
    const frameAge = lastFrameAtRef.current ? Date.now() - lastFrameAtRef.current : Infinity;
    if (!canvas || !cameraHasFrames || canvas.width === 0 || frameAge > CAPTURE_MAX_AGE_MS) {
      showToast('Sin imagen reciente de la cámara', false);
      return;
    }
    setPhotoActive(true);
    setTimeout(() => setPhotoActive(false), PHOTO_HIGHLIGHT_MS);
    canvas.toBlob((blob) => {
      if (!blob) { showToast('Sin imagen de cámara', false); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `laika-${DOG_ROBOT_ID}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast('Foto descargada');
    }, 'image/png');
  };

  // The server already records camera.mp4 for the whole mission; this is a
  // quick local clip download for the operator (canvas capture, web only),
  // same reasoning as takePhoto above.
  const startRecording = () => {
    const canvas = Platform.OS === 'web'
      ? document.getElementById('laika-camera-canvas') as HTMLCanvasElement | null
      : null;
    if (!canvas || typeof (canvas as any).captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      showToast('Grabación disponible en la web', false);
      return;
    }
    const stream: MediaStream = (canvas as any).captureStream(15);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    const began = Date.now();
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recordingDoneRef.current = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const durationMs = Date.now() - began;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `laika-${DOG_ROBOT_ID}-${new Date(began).toISOString().replace(/[:.]/g, '-')}.webm`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast(`Video descargado | ${formatShort(durationMs / 1000)}`);
        resolve();
      };
    });
    recorder.start(1000);
    recorderRef.current = recorder;
    setRecordingSince(began);
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecordingSince(null);
    if (recorder.state !== 'inactive') recorder.stop();
    await recordingDoneRef.current;
  };

  const choosePosture = (value: Posture) => {
    // Visual only for now: no robot command for stand/lie down yet.
    setPosture(value);
    setPostureOpen(false);
  };

  const finishMission = async () => {
    if (finishing) return;
    setFinishing(true);
    await stopRecording();
    if (misionActiva?.serverMissionId) {
      try {
        await stopServerMission(misionActiva.serverMissionId);
      } catch (err) {
        console.error('[stopServerMission] no se pudo finalizar la grabación', err);
        showToast('No se pudo cerrar la grabación en el servidor', false);
      }
    }
    setMisionActiva(null);
    router.replace('/');
  };

  // ── Status bar values ──
  const robotBattery = (() => {
    // null/undefined must stay unknown (Number(null) would read as 0%).
    const raw = telemetry?.battery;
    const fromTelemetry = raw == null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(fromTelemetry)) return fromTelemetry;
    return robotStatus?.battery ?? null;
  })();
  const connScore = connectionScore(mediaConnected, lastDataAtRef.current ? now - lastDataAtRef.current : Infinity, rttMs);
  const connLevel: 1 | 2 | 3 = connScore >= 65 ? 3 : connScore >= 35 ? 2 : 1;
  const thermalStale = thermalLastAt > 0 && now - thermalLastAt > THERMAL_STALE_MS;
  const missionSeconds = (now - startedAt) / 1000;

  const actions: { key: string; label: string; icon: IconName; active: boolean; chip?: string; onPress: () => void }[] = [
    {
      key: 'hablar',
      label: 'Hablar',
      icon: 'mic',
      active: talking,
      chip: talkRemaining != null ? `Transmitiendo: ${talkRemaining}s` : 'Abriendo micrófono…',
      onPress: toggleTalk,
    },
    {
      key: 'antichoque',
      label: 'Antichoque',
      icon: 'shield',
      active: safetyEnabled || safetyPending,
      chip: safetyPending ? 'Esperando confirmación' : 'Antichoque activado',
      onPress: toggleSafety,
    },
    {
      key: 'linterna',
      label: 'Linterna',
      icon: 'flashlight',
      active: flashlight || flashlightPending,
      chip: flashlightPending ? 'Esperando confirmación' : 'Linterna encendida',
      onPress: toggleLight,
    },
    { key: 'foto', label: 'Foto', icon: 'camera', active: photoActive, onPress: takePhoto },
    {
      key: 'grabar',
      label: recordingSince ? 'Detener' : 'Grabar',
      icon: recordingSince ? 'stop' : 'record',
      active: !!recordingSince,
      onPress: () => (recordingSince ? stopRecording() : startRecording()),
    },
    { key: 'postura', label: 'Postura', icon: 'paw', active: postureOpen, onPress: () => setPostureOpen((v) => !v) },
  ];

  const feed = FEEDS[feedIndex];

  return (
    <View style={styles.window}>
      {/* Stage: the four camera views, one visible at a time. */}
      <View ref={stageRef} style={styles.stage} {...swipeResponder.panHandlers}>
        {FEEDS.map((f, i) => (
          <View key={f.key} style={[styles.stageLayer, i !== feedIndex && styles.hidden]}>
            {f.key === 'camera' && <CameraFeed uri={cameraUri} hasFrames={cameraHasFrames} />}
            {f.key === 'thermal' && <ThermalFeed meta={thermalMeta} stale={thermalStale} hasFrames={thermalLastAt > 0} />}
            {f.key === 'lidar' && (Platform.OS === 'web'
              ? <LidarReconstruction sinkRef={lidarSinkRef} />
              : <LidarMapView points={lidarData?.points ?? null} count={lidarData?.count ?? 0} />)}
            {f.key === 'night' && <View style={styles.feed}><Text style={styles.feedEmptyText}>SIN SEÑAL</Text></View>}
          </View>
        ))}
      </View>

      {/* Top bar */}
      <TouchableOpacity activeOpacity={0.85} style={styles.homeButton} onPress={() => setExitVisible(true)}>
        <Icon name="home" size={d(24)} strokeWidth={2.2} />
      </TouchableOpacity>

      <View style={styles.statusPill}>
        <Icon name="batteryRobot" size={d(20)} color={levelColor(robotBattery)} />
        <Text style={styles.statusValue}>{robotBattery != null ? `${Math.round(robotBattery)}%` : '—'}</Text>
        <Text style={styles.statusLabel}>Robot</Text>
        <View style={styles.statusDivider} />
        <Icon name="phone" size={d(20)} color={levelColor(phoneBattery)} strokeWidth={2.2} />
        <Text style={styles.statusValue}>{phoneBattery != null ? `${phoneBattery}%` : '—'}</Text>
        <View style={styles.statusDivider} />
        <WifiIcon size={d(24)} color={levelColor(connScore)} level={connLevel} />
      </View>

      <View style={styles.rightStack}>
        <View style={styles.missionPill}>
          <Text style={styles.missionName} numberOfLines={1}>{missionName}</Text>
          <Text style={styles.missionTimer}>{formatClock(missionSeconds)}</Text>
        </View>
        {recordingSince && (
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>REC   {formatClock((now - recordingSince) / 1000)}</Text>
          </View>
        )}
      </View>

      {/* Camera indicator: label (page 18) + dots; swipe/tap here too. */}
      {feedLabelVisible && (
        <View style={styles.feedChip} pointerEvents="none">
          <Text style={styles.feedChipText}>{feed.label}</Text>
        </View>
      )}
      <View style={styles.dotsArea} {...dotsResponder.panHandlers}>
        {FEEDS.map((f, i) => (
          <Pressable key={f.key} hitSlop={6} onPress={() => selectFeed(i)}>
            <View style={[styles.dot, i === feedIndex && styles.dotActive]} />
          </Pressable>
        ))}
      </View>

      {/* Controls */}
      <View style={[styles.joyWrap, styles.joyWrapLeft]}>
        {joystickEnabled ? <Joystick which="left" label="MOVER" chevrons /> : <ArrowPad which="left" label="MOVER" />}
      </View>
      <View style={[styles.joyWrap, styles.joyWrapRight]}>
        {joystickEnabled ? <Joystick which="right" label="ROTAR" chevrons={false} /> : <ArrowPad which="right" label="ROTAR" />}
      </View>

      <View style={styles.barArea} pointerEvents="box-none">
        {postureOpen && (
          <View style={styles.posturePopup}>
            {(['parado', 'agachado'] as Posture[]).map((value) => (
              <TouchableOpacity
                key={value}
                activeOpacity={0.85}
                style={[styles.postureOption, posture === value && styles.actionButtonActive]}
                onPress={() => choosePosture(value)}
              >
                <Icon name={value === 'parado' ? 'dogStanding' : 'dogLying'} size={d(30)} />
                <Text style={styles.actionLabel}>{value === 'parado' ? 'Parado' : 'Agachado'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {!postureOpen && (
          <ActionChips actions={actions} />
        )}
        <View style={styles.actionBar}>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.key}
              activeOpacity={0.85}
              style={[styles.actionButton, a.active && styles.actionButtonActive]}
              onPress={a.onPress}
            >
              <Icon name={a.icon} size={d(22)} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <View style={[styles.toastIcon, !toast.ok && { backgroundColor: C.textFaint }]}>
            <Icon name={toast.ok ? 'check' : 'close'} size={d(12)} color="#fff" strokeWidth={3.4} />
          </View>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}

      {/* End mission (page 9) */}
      <Modal animationType="fade" transparent visible={exitVisible} onRequestClose={() => setExitVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Finalizar misión?</Text>
            <Text style={styles.modalText}>
              Se guardarán fotos, videos, audios y el recorrido en “{missionName}”.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity activeOpacity={0.85} style={styles.modalSecondary} disabled={finishing} onPress={() => setExitVisible(false)}>
                <Text style={styles.modalButtonText}>Seguir</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} style={styles.modalPrimary} disabled={finishing} onPress={finishMission}>
                <Text style={styles.modalButtonText}>{finishing ? 'Guardando…' : 'Finalizar y guardar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

