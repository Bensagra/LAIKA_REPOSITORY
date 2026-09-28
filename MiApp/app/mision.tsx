import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Pressable,
  Text,
  Animated,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  PanResponder,
  Switch,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ScreenOrientation from 'expo-screen-orientation';

import { styles } from '../styles/misionStyles';
import LidarReconstruction, { LidarSink, LidarSinkFrame } from '../components/LidarReconstruction';
import { s } from '../utils/scale';
import { useAppSettings } from '../contexts/AppSettings';
import {
  moveRobot,
  moveRobotAxes,
  getRobotStatus,
  RobotStatus,
  analyzeBuilding,
  AnalysisResult,
  DañoDetectado,
  finalizarMision,
  MisionGaleriaItem,
  emergencyStop,
  autonomousStart,
  autonomousStop,
  sendDogCommand,
} from '../services/api';
import { saveMissionVideo } from '../services/misionMedia';
import {
  connectRobotWS,
  registerThermalCanvas,
  registerVideoCanvas,
  ThermalFrameMeta,
  requestRobotSpeedProfile,
  sendRobotDrive,
  sendRobotDriveStop,
  sendRobotHeartbeat,
} from '../services/robotSocket';
import Svg, { Circle, Line } from 'react-native-svg';
import {
  applyDogColorCalibration,
  ColorCalibration,
  configureDogMedia,
  DEFAULT_SPEED_PROFILES,
  dogAutonomyAction,
  dogFaceImageUrl,
  DogFace,
  DogMediaSettings,
  DogMapMetadata,
  formatDogMapLabel,
  getDogCapabilities,
  getDogMeshSummary,
  getPerceptionCapabilities,
  listDogFaces,
  listDogMaps,
  LoadedDogMap,
  loadDogMap,
  NETWORK_PROFILES,
  NetworkProfileKey,
  purgeDogFaces,
  rebuildDogMesh,
  saveDogMapSnapshot,
  setDogGreeter,
  SpeedProfileKey,
  testDogGreeting,
  updateDogFace,
} from '../services/operator';

interface Edificio {
  nombre: string;
  previewUri: string;
  analysis: AnalysisResult;
}

interface VisualFeedState {
  uri: string | null;
  lastFrameAt: number;
}

interface OperatorEvent {
  id: string;
  ts: string;
  type: string;
  data: unknown;
}

interface AutonomyInfo {
  status: string;
  coverage: number | null;
  captures: number;
  goal: string | null;
  running: boolean;
}

const RED = '#f23b3f';
const OK = '#45d483';
const WARN = '#ffb347';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stringifyShort(value: unknown, max = 110) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function getSafetyReadout(telemetry: Record<string, unknown> | null) {
  const safety = (telemetry?.safety ?? {}) as any;
  const sectors = safety.sectors_m ?? {};
  const intervention = safety.last_intervention ?? {};
  const fmt = (v: unknown) => (v === null || v === undefined ? '∞' : `${Number(v).toFixed(2)}m`);
  return {
    guard: safety.enabled ? (safety.armed ? 'ARMADO' : 'sin LiDAR') : 'OFF',
    guardOk: !!safety.armed,
    front: fmt(sectors.front),
    frontDanger: sectors.front !== null && sectors.front !== undefined && Number(sectors.front) < 0.5,
    sides: `${fmt(sectors.left)} / ${fmt(sectors.right)} / ${fmt(sectors.back)}`,
    cliff: safety.cliff ? 'DETECTADO' : 'ok',
    cliffDanger: !!safety.cliff,
    last: intervention.blocked ? String((intervention.reasons ?? []).join(', ')) : 'ninguna',
  };
}

const StatusBadge = ({ text, mode = 'muted' }: { text: string; mode?: 'ok' | 'warn' | 'err' | 'muted' }) => (
  <View style={[
    styles.statusChip,
    mode === 'ok' && styles.statusChipOk,
    mode === 'warn' && styles.statusChipWarn,
    mode === 'err' && styles.statusChipErr,
  ]}>
    <Text style={[
      styles.statusChipText,
      mode === 'ok' && { color: OK },
      mode === 'warn' && { color: WARN },
      mode === 'err' && { color: RED },
    ]}>{text}</Text>
  </View>
);

const OperatorButton = ({
  label,
  onPress,
  tone = 'default',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
  disabled?: boolean;
}) => (
  <TouchableOpacity
    activeOpacity={0.75}
    disabled={disabled}
    onPress={onPress}
    style={[
      styles.operatorButton,
      tone === 'ok' && styles.operatorButtonOk,
      tone === 'warn' && styles.operatorButtonWarn,
      tone === 'danger' && styles.operatorButtonDanger,
      disabled && { opacity: 0.42 },
    ]}
  >
    <Text style={[
      styles.operatorButtonText,
      tone === 'ok' && { color: OK },
      tone === 'warn' && { color: WARN },
      tone === 'danger' && { color: RED },
    ]}>{label}</Text>
  </TouchableOpacity>
);

const NumberField = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
}) => {
  const set = (next: number) => onChange(Number(clamp(next, min, max).toFixed(decimals)));
  return (
    <View style={styles.numberField}>
      <Text style={styles.numberLabel}>{label}</Text>
      <View style={styles.numberControls}>
        <TouchableOpacity style={styles.numberStep} onPress={() => set(value - step)}>
          <Text style={styles.numberStepText}>−</Text>
        </TouchableOpacity>
        <TextInput
          value={value.toFixed(decimals)}
          onChangeText={(text) => {
            const parsed = Number(text.replace(',', '.'));
            if (Number.isFinite(parsed)) set(parsed);
          }}
          keyboardType="numeric"
          style={styles.numberInput}
        />
        <TouchableOpacity style={styles.numberStep} onPress={() => set(value + step)}>
          <Text style={styles.numberStepText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const MapPreview = ({ map }: { map: LoadedDogMap | null }) => {
  const W = 338, H = 170, PAD = 8;
  const { dots, path } = React.useMemo(() => {
    if (!map || map.points.length < 3) return { dots: [] as { cx: number; cy: number }[], path: [] as { x: number; y: number }[] };
    const count = map.points.length / 3;
    const sampleStep = Math.max(1, Math.ceil(count / 650));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i += sampleStep) {
      const x = map.points[i * 3], y = map.points[i * 3 + 1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const rx = (maxX - minX) || 1;
    const ry = (maxY - minY) || 1;
    const project = (x: number, y: number) => ({
      x: PAD + ((x - minX) / rx) * (W - 2 * PAD),
      y: H - (PAD + ((y - minY) / ry) * (H - 2 * PAD)),
    });
    const dots = [];
    for (let i = 0; i < count; i += sampleStep) {
      const p = project(map.points[i * 3], map.points[i * 3 + 1]);
      dots.push({ cx: p.x, cy: p.y });
    }
    const path = [];
    for (let i = 0; i < map.path.length / 2; i += Math.max(1, Math.ceil((map.path.length / 2) / 160))) {
      path.push(project(map.path[i * 2], map.path[i * 2 + 1]));
    }
    return { dots, path };
  }, [map]);

  return (
    <View style={styles.savedMapPreview}>
      {map ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          {path.length > 1 && path.slice(1).map((p, i) => (
            <Line key={`path-${i}`} x1={path[i].x} y1={path[i].y} x2={p.x} y2={p.y} stroke={WARN} strokeWidth={1.4} opacity={0.9} />
          ))}
          {dots.map((d, i) => (
            <Circle key={i} cx={d.cx} cy={d.cy} r={1.1} fill="#00e676" opacity={0.72} />
          ))}
        </Svg>
      ) : (
        <Text style={styles.savedMapPlaceholder}>MAPA 3D</Text>
      )}
    </View>
  );
};

const joystickState = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };

function makeJoystick(which: 'left' | 'right') {
  return function JoystickBase() {
    const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
    const MAX = s(60);

    const release = useCallback(() => {
      setStickPos({ x: 0, y: 0 });
      joystickState[which] = { x: 0, y: 0 };
    }, []);

    const pan = useRef(PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, { dx, dy }) => {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const r = dist > MAX ? MAX / dist : 1;
        const pos = { x: dx * r, y: dy * r };
        setStickPos(pos);
        joystickState[which] = { x: pos.x / MAX, y: pos.y / MAX };
      },
      onPanResponderRelease: () => release(),
      onPanResponderTerminate: () => release(),
    })).current;

    return (
      <View style={styles.joystickArea} {...pan.panHandlers}>
        <View style={styles.joystickBase}>
          <View style={[styles.joystickStick, {
            transform: [{ translateX: stickPos.x }, { translateY: stickPos.y }],
          }]} />
        </View>
      </View>
    );
  };
}

const JoystickLeft = makeJoystick('left');
const JoystickRight = makeJoystick('right');

const DPad = () => {
  const { robotSpeed } = useAppSettings();
  const spd = robotSpeed / 100;
  return (
    <View style={styles.dpadArea}>
      <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('forward', spd).catch(() => {})}>
        <MaterialIcons name="keyboard-arrow-up" size={s(26)} color="#161616" />
      </TouchableOpacity>
      <View style={styles.dpadMiddleRow}>
        <TouchableOpacity style={styles.dpadBtnSmall} onPress={() => moveRobot('strafeL', spd).catch(() => {})}>
          <Text style={styles.dpadSmallText}>SL</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('left', spd).catch(() => {})}>
          <MaterialIcons name="keyboard-arrow-left" size={s(26)} color="#161616" />
        </TouchableOpacity>
        <View style={styles.dpadCenter} />
        <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('right', spd).catch(() => {})}>
          <MaterialIcons name="keyboard-arrow-right" size={s(26)} color="#161616" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.dpadBtnSmall} onPress={() => moveRobot('strafeR', spd).catch(() => {})}>
          <Text style={styles.dpadSmallText}>SR</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('backward', spd).catch(() => {})}>
        <MaterialIcons name="keyboard-arrow-down" size={s(26)} color="#161616" />
      </TouchableOpacity>
    </View>
  );
};

const LidarMapView = React.memo(({
  points,
  count,
  status,
  style,
}: {
  points: Float32Array | null;
  count: number;
  status: string;
  style?: object;
}) => {
  const W = 220, H = 160, PAD = 6;

  const dots = React.useMemo(() => {
    if (!points || count === 0) return [];
    const step = Math.max(1, Math.ceil(count / 350));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i += step) {
      const x = points[i * 3], y = points[i * 3 + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const rx = (maxX - minX) || 1, ry = (maxY - minY) || 1;
    const result: { cx: number; cy: number }[] = [];
    for (let i = 0; i < count; i += step) {
      result.push({
        cx: PAD + ((points[i * 3] - minX) / rx) * (W - 2 * PAD),
        cy: PAD + ((points[i * 3 + 1] - minY) / ry) * (H - 2 * PAD),
      });
    }
    return result;
  }, [points, count]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Web: paint on a canvas instead of hundreds of SVG DOM nodes per frame.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0, 230, 118, 0.85)';
    for (const d of dots) ctx.fillRect(d.cx - 1.2, d.cy - 1.2, 2.4, 2.4);
  }, [dots]);

  // Transparent and label-free when empty, so the feed reads as a plain panel.
  return (
    <View style={[{ overflow: 'hidden' }, style]} pointerEvents="none">
      {Platform.OS === 'web' ? (
        React.createElement('canvas', {
          ref: canvasRef,
          width: W,
          height: H,
          style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
        })
      ) : dots.length > 0 ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          {dots.map((d, i) => (
            <Circle key={i} cx={d.cx} cy={d.cy} r={1.2} fill="#00e676" opacity={0.85} />
          ))}
        </Svg>
      ) : null}
      {dots.length > 0 && (
        <View style={{ position: 'absolute', bottom: 4, left: 6 }}>
          <Text style={{ color: '#00e676', fontSize: 9, fontFamily: 'monospace' }}>{status}</Text>
        </View>
      )}
    </View>
  );
});
LidarMapView.displayName = 'LidarMapView';

const FeedBadge = ({ status }: { status: string }) => (
  <View style={styles.feedBadge} pointerEvents="none">
    <Text style={styles.feedBadgeText}>{status}</Text>
  </View>
);

type LidarFrame = { points: Float32Array; count: number; colors: Uint8Array | null };

// Map-protocol fields from the LiDAR frame header (keyframe/delta, robot pose).
function lidarSinkFrame(points: Float32Array, colors: Uint8Array | null, header: Record<string, any> | undefined): LidarSinkFrame {
  const pose = header?.pose;
  return {
    points,
    colors,
    mode: String(header?.mode ?? 'delta'),
    pose: pose ? { x: Number(pose.x), y: Number(pose.y), yaw: Number(pose.yaw ?? 0) } : null,
    path: Array.isArray(header?.path) ? header!.path : null,
  };
}

const LidarFeed = ({
  lidarData,
  sinkRef,
  status,
  showBadge,
}: {
  lidarData: LidarFrame | null;
  sinkRef: React.MutableRefObject<LidarSink | null>;
  status: string;
  showBadge: boolean;
}) => (
  <View style={[styles.videoStreamContainer, styles.lidarStreamContainer]}>
    {Platform.OS === 'web' ? (
      // Solid voxel map (three.js); frames are pushed straight into sinkRef.
      <LidarReconstruction sinkRef={sinkRef} />
    ) : (
      <LidarMapView
        points={lidarData?.points ?? null}
        count={lidarData?.count ?? 0}
        status={status}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
    )}
    {showBadge && <FeedBadge status={status} />}
  </View>
);

const CameraFeed = ({
  feed,
  status,
  showBadge,
}: {
  feed: VisualFeedState;
  status: string;
  showBadge: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;
    return registerVideoCanvas(canvasRef.current);
  }, []);

  return (
    <View style={[styles.videoStreamContainer, styles.noSignalFeed]}>
      {Platform.OS === 'web'
        ? React.createElement('canvas', {
          ref: canvasRef,
          id: 'laika-camera-canvas',
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            // Until frames arrive, let the screen background show through.
            backgroundColor: feed.lastFrameAt ? '#000' : 'transparent',
          },
        })
        : feed.uri && <Image source={{ uri: feed.uri }} style={styles.liveFeedImage} resizeMode="cover" />}
      {showBadge && <FeedBadge status={status} />}
    </View>
  );
};

type FeedTileKey = 'cam' | 'lidar' | 'thermal' | 'ir';

// Label corner per grid tile (TL, TR, BL, BR): the corner nearest the center.
const FEED_LABEL_CORNERS = [
  { right: 8, bottom: 8, alignItems: 'flex-end' as const },
  { left: 8, bottom: 8 },
  { right: 8, top: 8, alignItems: 'flex-end' as const },
  { left: 8, top: 8 },
];

const THERMAL_STALE_MS = 3000;

interface ThermalInfo {
  meta: ThermalFrameMeta | null;
  lastFrameAt: number;
  stale: boolean;
  fps: number;
}

const fmtC = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}°` : '--');

// SenXor heat map from the server (boxes already drawn into the JPEG).
const ThermalFeed = ({ info }: { info: ThermalInfo }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;
    return registerThermalCanvas(canvasRef.current);
  }, []);

  const hasFrame = info.lastFrameAt > 0;
  const temp = info.meta?.temperature;
  // Detection is only meaningful while frames are fresh.
  const person = !info.stale && !!info.meta?.detection?.person_present;

  return (
    <View style={[styles.videoStreamContainer, styles.noSignalFeed]}>
      {Platform.OS === 'web' && React.createElement('canvas', {
        ref: canvasRef,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          opacity: info.stale ? 0.35 : 1,
        },
      })}
      {(!hasFrame || info.stale) && (
        <View style={styles.cameraPlaceholderOverlay} pointerEvents="none">
          <Text style={styles.noSignalText}>{hasFrame ? 'SEÑAL INTERRUMPIDA' : 'SIN SEÑAL'}</Text>
        </View>
      )}
      {hasFrame && !info.stale && (
        <View style={styles.thermalReadout} pointerEvents="none">
          <Text style={styles.thermalReadoutText}>
            min {fmtC(temp?.min_c)} · máx {fmtC(temp?.max_c)} · centro {fmtC(temp?.center_c)}
          </Text>
          {person && (
            <View style={styles.thermalPersonBadge}>
              <Text style={styles.thermalPersonText}>POSIBLE PERSONA</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// IR camera has no stream from the robot yet.
const NoSignalFeed = () => (
  <View style={[styles.videoStreamContainer, styles.noSignalFeed]}>
    <Text style={styles.noSignalText}>SIN SEÑAL</Text>
  </View>
);

const PadlockIcon = ({ open }: { open: boolean }) => (
  <View style={{ alignItems: 'center' }}>
    <View style={[styles.lockShackle, open && styles.lockShackleOpen]} />
    <View style={styles.lockBody} />
  </View>
);

function getFeedStatus(
  feed: VisualFeedState,
  label: string,
  mediaConnected: boolean,
  mediaError: string | null,
  nowMs: number
) {
  if (mediaError && !feed.uri) return `${label} offline`;
  if (!mediaConnected && !feed.uri) return `${label} conectando`;
  if (!feed.lastFrameAt) return `${label} esperando`;

  const ageSec = Math.max(0, Math.round((nowMs - feed.lastFrameAt) / 1000));
  return ageSec > 3 ? `${label} ${ageSec}s` : `${label} live`;
}

export default function MisionScreen() {
  const router = useRouter();
  const { joystickEnabled, misionActiva, setMisionActiva, robotSpeed, setRobotSpeed, videoResolution, lidarMaxPoints } = useAppSettings();
  const [isExtraFeature, setIsExtraFeature] = useState(false);
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);

  const [expandedTile, setExpandedTile] = useState<FeedTileKey | null>(null);
  const lastTapRef = useRef<{ key: FeedTileKey | null; at: number }>({ key: null, at: 0 });
  const [menuVisible, setMenuVisible] = useState(false);
  const [homeHovered, setHomeHovered] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [aiVisible, setAiVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [edificios, setEdificios] = useState<Edificio[]>([]);
  const [galeria, setGaleria] = useState<MisionGaleriaItem[]>([]);
  const [grabandoPantalla, setGrabandoPantalla] = useState(false);
  const [cameraFeed, setCameraFeed] = useState<VisualFeedState>({ uri: null, lastFrameAt: 0 });
  const [mediaConnected, setMediaConnected] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Record<string, unknown> | null>(null);
  const [lidarData, setLidarData] = useState<LidarFrame | null>(null);
  const lidarSinkRef = useRef<LidarSink | null>(null);
  const [thermalInfo, setThermalInfo] = useState<ThermalInfo>({ meta: null, lastFrameAt: 0, stale: false, fps: 0 });
  const thermalLatestRef = useRef<ThermalFrameMeta | null>(null);
  const thermalUiAtRef = useRef(0);
  const thermalFramesRef = useRef(0);
  const thermalStaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [operatorEvents, setOperatorEvents] = useState<OperatorEvent[]>([]);
  const [networkProfile, setNetworkProfile] = useState<NetworkProfileKey>('weak');
  const [mediaSettings, setMediaSettings] = useState<Omit<DogMediaSettings, 'profile'>>(() => ({
    video: true,
    lidar: true,
    audio: false,
    cameraFps: NETWORK_PROFILES.weak.cameraFps,
    cameraQuality: NETWORK_PROFILES.weak.cameraQuality,
    cameraWidth: videoResolution,
    cameraBitrateKbps: NETWORK_PROFILES.weak.cameraBitrateKbps,
    lidarMaxPoints,
    audioEmitEvery: 2,
    audioMaxBytes: 24576,
  }));
  const [mediaApplyStatus, setMediaApplyStatus] = useState('media lista');
  const [speedProfile, setSpeedProfile] = useState<SpeedProfileKey>('normal');
  const [speedProfiles, setSpeedProfiles] = useState({
    normal: { ...DEFAULT_SPEED_PROFILES.normal },
    max_api: { ...DEFAULT_SPEED_PROFILES.max_api },
  });
  const [requestedMove, setRequestedMove] = useState({ x: 0, y: 0, z: 0 });
  const [autonomyInfo, setAutonomyInfo] = useState<AutonomyInfo>({
    status: 'manual',
    coverage: null,
    captures: 0,
    goal: null,
    running: false,
  });
  const [greeterOn, setGreeterOn] = useState(false);
  const [greeterStatus, setGreeterStatus] = useState('saludo: --');
  const [faces, setFaces] = useState<DogFace[]>([]);
  const [facesStatus, setFacesStatus] = useState('caras: --');
  const [perceptionStatus, setPerceptionStatus] = useState('percepción: --');
  const [maps, setMaps] = useState<DogMapMetadata[]>([]);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [loadedMap, setLoadedMap] = useState<LoadedDogMap | null>(null);
  const [mapStatus, setMapStatus] = useState('mapas: --');
  const [meshStatus, setMeshStatus] = useState('modelo: --');
  const [meshSummary, setMeshSummary] = useState<{ vertexCount: number; faceCount: number } | null>(null);
  const [colorCalibration, setColorCalibration] = useState<ColorCalibration>({
    enabled: true,
    fovDeg: 150,
    pitchDeg: 0,
    heightM: 0.3,
    forwardM: 0.25,
  });
  const [netStats, setNetStats] = useState({ video: 0, lidar: 0, audio: 0, total: 0 });
  const [recordingLidar, setRecordingLidar] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState(0);
  const lastVideoRef = useRef(0);
  const lastVideoUiRef = useRef(0);
  const lastTelemetryRef = useRef(0);
  const lastLidarRef = useRef(0);
  const netBytesRef = useRef({ video: 0, lidar: 0, audio: 0 });
  const keyStateRef = useRef<Set<string>>(new Set());
  const mediaSettingsRef = useRef(mediaSettings);
  const networkProfileRef = useRef(networkProfile);
  const lidarRecordRef = useRef<{ recording: boolean; startedAt: number; frames: ({ t: number; header?: Record<string, any> } & LidarFrame)[] }>({
    recording: false,
    startedAt: 0,
    frames: [],
  });
  const screenRecorderRef = useRef<any>(null);
  const screenStreamRef = useRef<any>(null);
  const [autoMode, setAutoMode] = useState(false);

  const menuAnim = useRef(new Animated.Value(0)).current;

  // Events can arrive many times per second over the WS; buffer them and
  // flush in one state update so the whole screen doesn't re-render per event.
  const pendingEventsRef = useRef<OperatorEvent[]>([]);
  const eventFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addOperatorEvent = useCallback((type: string, data: unknown) => {
    pendingEventsRef.current.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ts: new Date().toLocaleTimeString('es-AR'),
      type,
      data,
    });
    if (eventFlushTimerRef.current) return;
    eventFlushTimerRef.current = setTimeout(() => {
      eventFlushTimerRef.current = null;
      const batch = pendingEventsRef.current;
      pendingEventsRef.current = [];
      setOperatorEvents((prev) => [...batch, ...prev].slice(0, 80));
    }, 500);
  }, []);

  useEffect(() => () => {
    if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
  }, []);

  const refreshCapabilities = useCallback(async () => {
    try {
      const caps = await getDogCapabilities();
      if (caps.speed_profiles) {
        setSpeedProfiles({
          normal: { ...DEFAULT_SPEED_PROFILES.normal, ...(caps.speed_profiles.normal ?? {}) },
          max_api: { ...DEFAULT_SPEED_PROFILES.max_api, ...(caps.speed_profiles.max_api ?? {}) },
        });
      }
      if (caps.active_speed_profile === 'max_api' || caps.active_speed_profile === 'normal') {
        setSpeedProfile(caps.active_speed_profile);
      }
      addOperatorEvent('capabilities', { role: caps.role, active_speed_profile: caps.active_speed_profile });
    } catch (error) {
      addOperatorEvent('capabilities_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent]);

  const refreshFaces = useCallback(async () => {
    try {
      const [people, caps] = await Promise.all([
        listDogFaces(),
        getPerceptionCapabilities().catch(() => null),
      ]);
      setFaces(people);
      setFacesStatus(people.length ? `${people.length} persona(s)` : 'sin caras capturadas');
      if (caps) {
        const face = caps.face ?? {};
        const person = caps.person_detector ?? {};
        setPerceptionStatus(
          caps.enabled
            ? `personas ${person.available ? 'ON' : 'off'} · caras ${face.available ? 'ON' : 'off'} · reconoce ${face.recognition ? 'sí' : 'no'}`
            : 'percepción deshabilitada'
        );
      }
    } catch (error) {
      setFacesStatus('caras: error');
      addOperatorEvent('faces_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent]);

  const refreshMaps = useCallback(async () => {
    try {
      setMapStatus('consultando mapas...');
      const next = await listDogMaps();
      setMaps(next);
      const preferred = next.find((m) => m.is_latest)?.map_id ?? next[0]?.map_id ?? '';
      setSelectedMapId((current) => current || preferred);
      setMapStatus(next.length ? `${next.length} mapa(s) en servidor` : 'sin mapas guardados');
    } catch (error) {
      setMapStatus('mapas: error');
      addOperatorEvent('maps_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent]);

  const refreshMesh = useCallback(async () => {
    try {
      setMeshStatus('descargando resumen...');
      const summary = await getDogMeshSummary();
      setMeshSummary(summary);
      setMeshStatus(`${summary.vertexCount.toLocaleString()} vértices · ${summary.faceCount.toLocaleString()} caras`);
    } catch (error) {
      setMeshStatus('sin modelo cargado');
      addOperatorEvent('mesh_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent]);

  const applyMediaSettings = useCallback(async (settings = mediaSettings, profile = networkProfile) => {
    try {
      setMediaApplyStatus('aplicando media...');
      await configureDogMedia({ ...settings, profile });
      setMediaApplyStatus(`${NETWORK_PROFILES[profile].label} · cam ${settings.cameraFps}fps · lidar ${settings.lidar ? 'ON' : 'off'} · audio ${settings.audio ? 'ON' : 'off'}`);
      addOperatorEvent('media_config_applied', { profile, ...settings });
    } catch (error) {
      setMediaApplyStatus('media: error');
      addOperatorEvent('media_config_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, mediaSettings, networkProfile]);

  const selectNetworkProfile = useCallback((profile: NetworkProfileKey) => {
    const preset = NETWORK_PROFILES[profile];
    const next = {
      ...mediaSettings,
      cameraFps: preset.cameraFps,
      cameraQuality: preset.cameraQuality,
      cameraWidth: preset.cameraWidth,
      cameraBitrateKbps: preset.cameraBitrateKbps,
      lidarMaxPoints: preset.lidarMaxPoints,
    };
    setNetworkProfile(profile);
    setMediaSettings(next);
    if (mediaConnected) void applyMediaSettings(next, profile);
  }, [applyMediaSettings, mediaConnected, mediaSettings]);

  const currentSpeedPreset = useCallback(() => {
    const scale = robotSpeed / 100;
    const profile = speedProfiles[speedProfile] ?? speedProfiles.normal;
    return {
      forward: profile.forward * scale,
      reverse: profile.reverse * scale,
      lateral: profile.lateral * scale,
      angular: profile.angular * scale,
    };
  }, [robotSpeed, speedProfile, speedProfiles]);

  const requestSpeedMode = useCallback((next: SpeedProfileKey) => {
    sendRobotDriveStop();
    const ok = requestRobotSpeedProfile(next);
    if (ok) {
      setSpeedProfile(next);
      addOperatorEvent('speed_profile_requested', next);
    } else {
      addOperatorEvent('speed_profile_error', 'WebSocket no disponible');
    }
  }, [addOperatorEvent]);

  const updateAutonomyFromMessage = useCallback((message: Record<string, any>) => {
    const event = String(message.event ?? '');
    const data = message.data ?? {};
    if (event === 'autonomy_state') {
      const plan = data.plan ?? {};
      setAutonomyInfo((prev) => ({
        status: data.state ?? prev.status,
        coverage: plan.coverage ?? prev.coverage,
        captures: data.captures ?? prev.captures,
        goal: Array.isArray(plan.goal_xy) ? plan.goal_xy.map((v: number) => Number(v).toFixed(1)).join(', ') : prev.goal,
        running: !!data.running,
      }));
    } else if (event === 'autonomy_done') {
      setAutonomyInfo((prev) => ({
        ...prev,
        status: 'done',
        coverage: data.coverage ?? prev.coverage,
        running: false,
      }));
    } else if (event === 'person_captured') {
      setAutonomyInfo((prev) => ({ ...prev, captures: prev.captures + 1 }));
      void refreshFaces();
    } else if (event === 'autonomy_error') {
      setAutonomyInfo((prev) => ({ ...prev, status: 'error', running: false }));
    }
  }, [refreshFaces]);

  const runAutonomyAction = useCallback(async (action: 'start' | 'stop' | 'estop') => {
    try {
      const result = await dogAutonomyAction(action);
      setAutoMode(action === 'start');
      setAutonomyInfo((prev) => ({
        ...prev,
        status: String(result.state ?? action),
        running: action === 'start',
      }));
      addOperatorEvent('autonomy_action', { action, result });
    } catch (error) {
      addOperatorEvent('autonomy_error', error instanceof Error ? error.message : String(error));
      if (action === 'start') {
        setAutoMode(true);
        autonomousStart().catch(() => setAutoMode(false));
      } else {
        setAutoMode(false);
        autonomousStop().catch(() => {});
      }
    }
  }, [addOperatorEvent]);

  const toggleGreeter = useCallback(async () => {
    try {
      const result = await setDogGreeter(!greeterOn);
      setGreeterOn(!!result.enabled);
      setGreeterStatus(result.available ? 'saludo listo' : 'sin detector de personas');
      addOperatorEvent('greeter', result);
    } catch (error) {
      setGreeterStatus('saludo: error');
      addOperatorEvent('greeter_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, greeterOn]);

  const saveSnapshot = useCallback(async () => {
    try {
      setMapStatus('guardando snapshot...');
      const saved = await saveDogMapSnapshot();
      addOperatorEvent('map_snapshot_saved', saved);
      await refreshMaps();
      setSelectedMapId(saved.map_id || 'latest');
      setMapStatus(`snapshot guardado · ${Number(saved.point_count || 0).toLocaleString()} pts`);
    } catch (error) {
      setMapStatus('snapshot: error');
      addOperatorEvent('map_snapshot_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, refreshMaps]);

  const openSelectedMap = useCallback(async () => {
    if (!selectedMapId) {
      setMapStatus('elegí un mapa');
      return;
    }
    try {
      setMapStatus('descargando mapa...');
      const map = await loadDogMap(selectedMapId);
      setLoadedMap(map);
      setMapStatus(`${(map.points.length / 3).toLocaleString()} puntos · ${(map.path.length / 2).toLocaleString()} poses`);
      addOperatorEvent('map_loaded', map.metadata);
    } catch (error) {
      setMapStatus('mapa: error');
      addOperatorEvent('map_load_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, selectedMapId]);

  const rebuildMesh = useCallback(async () => {
    try {
      setMeshStatus('reconstruyendo...');
      const result = await rebuildDogMesh();
      addOperatorEvent('mesh_rebuild', result);
      await refreshMesh();
    } catch (error) {
      setMeshStatus('reconstrucción: error');
      addOperatorEvent('mesh_rebuild_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, refreshMesh]);

  const applyColor = useCallback(async () => {
    try {
      await applyDogColorCalibration(colorCalibration);
      addOperatorEvent('color_config', colorCalibration);
    } catch (error) {
      addOperatorEvent('color_config_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, colorCalibration]);

  const clearLiveLidar = useCallback(() => {
    setLidarData(null);
    lidarSinkRef.current?.clear();
    lidarRecordRef.current.frames = [];
    setRecordedFrames(0);
    addOperatorEvent('lidar_clear', 'mapa en vivo limpiado');
  }, [addOperatorEvent]);

  const toggleLidarRecording = useCallback(() => {
    const rec = lidarRecordRef.current;
    rec.recording = !rec.recording;
    setRecordingLidar(rec.recording);
    if (rec.recording) {
      rec.frames = [];
      rec.startedAt = Date.now();
      setRecordedFrames(0);
      addOperatorEvent('lidar_record', 'grabación iniciada');
    } else {
      setRecordedFrames(rec.frames.length);
      addOperatorEvent('lidar_record', `grabación detenida · ${rec.frames.length} cuadros`);
    }
  }, [addOperatorEvent]);

  const replayLidarRecording = useCallback(() => {
    const frames = [...lidarRecordRef.current.frames];
    if (!frames.length) return;
    setLidarData(null);
    lidarSinkRef.current?.clear();
    addOperatorEvent('lidar_replay', `${frames.length} cuadros`);
    const started = Date.now();
    let index = 0;
    const tick = () => {
      const elapsed = Date.now() - started;
      while (index < frames.length && frames[index].t <= elapsed) {
        const f = frames[index];
        lidarSinkRef.current?.addFrame(lidarSinkFrame(f.points, f.colors, f.header));
        setLidarData({ points: f.points, count: f.count, colors: f.colors });
        index += 1;
      }
      if (index < frames.length) setTimeout(tick, 30);
    };
    tick();
  }, [addOperatorEvent]);

  const exportLidarRecording = useCallback(() => {
    if (Platform.OS !== 'web') {
      addOperatorEvent('lidar_export', 'exportación disponible en web');
      return;
    }
    const frames = lidarRecordRef.current.frames;
    if (!frames.length) return;
    const payload = JSON.stringify({
      version: 1,
      created_at: Date.now(),
      frames: frames.map((frame) => ({
        t: frame.t,
        count: frame.count,
        points: Array.from(frame.points),
      })),
    });
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laika_lidar_${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addOperatorEvent('lidar_export', `${frames.length} cuadros`);
  }, [addOperatorEvent]);

  const labelFace = useCallback(async (face: DogFace) => {
    if (Platform.OS !== 'web') return;
    const label = window.prompt('Nombre para esta persona:', face.label || '');
    if (label === null) return;
    const known = window.confirm('¿Marcar como conocida?');
    try {
      await updateDogFace(face.person_id, label, known);
      await refreshFaces();
      addOperatorEvent('face_label', { person_id: face.person_id, label, known });
    } catch (error) {
      addOperatorEvent('face_label_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, refreshFaces]);

  const purgeFacesAction = useCallback(async () => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm('¿Borrar todas las caras capturadas?')
      : true;
    if (!confirmed) return;
    try {
      await purgeDogFaces();
      await refreshFaces();
      addOperatorEvent('faces_purged', 'ok');
    } catch (error) {
      addOperatorEvent('faces_purge_error', error instanceof Error ? error.message : String(error));
    }
  }, [addOperatorEvent, refreshFaces]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  useEffect(() => {
    mediaSettingsRef.current = mediaSettings;
    networkProfileRef.current = networkProfile;
  }, [mediaSettings, networkProfile]);

  useEffect(() => {
    setMediaSettings((prev) => ({ ...prev, cameraWidth: videoResolution, lidarMaxPoints }));
  }, [lidarMaxPoints, videoResolution]);

  useEffect(() => {
    getRobotStatus().then(setRobotStatus).catch(() => {});
    const interval = setInterval(() => {
      getRobotStatus().then(setRobotStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const disconnect = connectRobotWS({
      onOpen: () => {
        addOperatorEvent('ws_open', 'robot conectado');
        setMediaApplyStatus('aplicando media...');
        configureDogMedia({
          ...mediaSettingsRef.current,
          profile: networkProfileRef.current,
        })
          .then(() => setMediaApplyStatus('media aplicada'))
          .catch((error) => addOperatorEvent('media_config_error', error instanceof Error ? error.message : String(error)));
        void refreshCapabilities();
        void refreshMaps();
        void refreshMesh();
        void refreshFaces();
      },
      onVideoFrame: (uri) => {
        const now = Date.now();
        if (Platform.OS === 'web') {
          if (now - lastVideoUiRef.current < 1000) return;
          lastVideoUiRef.current = now;
          setCameraFeed((prev) => ({ uri: prev.uri, lastFrameAt: now }));
          return;
        }
        if (now - lastVideoRef.current < 100) return;
        lastVideoRef.current = now;
        setCameraFeed({ uri, lastFrameAt: now });
      },
      onVideoTick: () => {
        const now = Date.now();
        if (now - lastVideoUiRef.current < 1000) return;
        lastVideoUiRef.current = now;
        setCameraFeed((prev) => ({ uri: prev.uri, lastFrameAt: now }));
      },
      onTelemetry: (data) => {
        const now = Date.now();
        if (now - lastTelemetryRef.current < 500) return;
        lastTelemetryRef.current = now;
        setTelemetry(data);
        const autonomy = (data.autonomy ?? {}) as any;
        if (autonomy && typeof autonomy === 'object') {
          setAutonomyInfo((prev) => ({
            ...prev,
            status: autonomy.enabled ? (autonomy.driving ? 'conduciendo' : 'activa') : prev.running ? prev.status : 'manual',
          }));
        }
      },
      onLidar: (points, count, meta) => {
        const now = Date.now();
        const colors = meta?.colors ?? null;
        const header = meta?.header as Record<string, any> | undefined;
        // Every frame goes to the 3D map: deltas only carry new points, so a
        // dropped frame would leave a permanent hole.
        lidarSinkRef.current?.addFrame(lidarSinkFrame(points, colors, header));
        const rec = lidarRecordRef.current;
        if (rec.recording) {
          rec.frames.push({ t: now - rec.startedAt, points: points.slice(0), count, colors: colors?.slice(0) ?? null, header });
          if (rec.frames.length > 1200) rec.frames.shift();
        }
        // UI state (status text, native 2D view) only needs a few updates/s.
        if (now - lastLidarRef.current < 400) return;
        lastLidarRef.current = now;
        setLidarData({ points, count, colors });
        if (rec.recording) setRecordedFrames(rec.frames.length);
      },
      onStatus: (connected) => {
        setMediaConnected(connected);
        if (!connected) setMediaError('sin señal robot');
        else setMediaError(null);
      },
      onAutonomy: updateAutonomyFromMessage,
      onMeshReady: (data) => {
        setMeshStatus(`modelo nuevo disponible · ${Number(data.vertex_count || 0).toLocaleString()} vértices`);
        addOperatorEvent('mesh_ready', data);
      },
      onCommandAck: (data) => {
        const commandType = String(data.command_type ?? '');
        if (commandType === 'set_speed_profile' && data.ok !== false) {
          const profile = data.profile === 'max_api' ? 'max_api' : 'normal';
          setSpeedProfile(profile);
        }
      },
      onEvent: addOperatorEvent,
      onAudio: () => {
        addOperatorEvent('audio_packet', 'audio recibido');
      },
      onNetBytes: (stream, bytes) => {
        const key = stream === 'lidar' ? 'lidar' : stream === 'audio' ? 'audio' : 'video';
        netBytesRef.current[key] += bytes;
      },
      onThermal: (meta) => {
        // The canvas is painted by robotSocket at full rate (~8 fps); the
        // readout only needs a few updates per second.
        const now = Date.now();
        thermalFramesRef.current += 1;
        thermalLatestRef.current = meta;
        if (thermalStaleTimerRef.current) clearTimeout(thermalStaleTimerRef.current);
        thermalStaleTimerRef.current = setTimeout(() => {
          setThermalInfo((prev) => ({ ...prev, stale: true }));
        }, THERMAL_STALE_MS);
        if (now - thermalUiAtRef.current < 300) return;
        thermalUiAtRef.current = now;
        setThermalInfo((prev) => ({ ...prev, meta, lastFrameAt: now, stale: false }));
      },
    });
    return disconnect;
  }, [addOperatorEvent, refreshCapabilities, refreshFaces, refreshMaps, refreshMesh, updateAutonomyFromMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      const bytes = netBytesRef.current;
      const next = {
        video: Math.round((bytes.video * 8) / 1000),
        lidar: Math.round((bytes.lidar * 8) / 1000),
        audio: Math.round((bytes.audio * 8) / 1000),
        total: Math.round(((bytes.video + bytes.lidar + bytes.audio) * 8) / 1000),
      };
      setNetStats((prev) => (
        prev.video === next.video && prev.lidar === next.lidar && prev.audio === next.audio ? prev : next
      ));
      netBytesRef.current = { video: 0, lidar: 0, audio: 0 };
      const thermalFps = thermalFramesRef.current;
      thermalFramesRef.current = 0;
      setThermalInfo((prev) => (prev.fps === thermalFps ? prev : { ...prev, fps: thermalFps }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => () => {
    if (thermalStaleTimerRef.current) clearTimeout(thermalStaleTimerRef.current);
  }, []);

  // Keep-alive for the robot's control watchdog (same 500 ms as benyi2.html).
  useEffect(() => {
    if (!mediaConnected) return;
    const interval = setInterval(() => sendRobotHeartbeat(), 500);
    return () => clearInterval(interval);
  }, [mediaConnected]);

  useEffect(() => {
    const movementKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
      'KeyQ', 'KeyE', 'KeyZ', 'KeyC',
      'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit6',
      'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad6',
    ]);
    const typingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el?.matches?.('input, textarea, select, [contenteditable="true"]');
    };
    let wasActive = false;
    let lastSig = '';
    let httpDriveInFlight = false;

    const sendDrive = () => {
      const keys = keyStateRef.current;
      const speed = currentSpeedPreset();
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
      const sig = `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
      if (sig !== lastSig) {
        lastSig = sig;
        setRequestedMove({ x, y, z });
      }
    };

    const loop = setInterval(sendDrive, 80);

    if (Platform.OS !== 'web') {
      return () => clearInterval(loop);
    }

    const down = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        keyStateRef.current.clear();
        joystickState.left = { x: 0, y: 0 };
        joystickState.right = { x: 0, y: 0 };
        sendRobotDriveStop();
        emergencyStop().catch(() => {});
        setRequestedMove({ x: 0, y: 0, z: 0 });
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
      setRequestedMove({ x: 0, y: 0, z: 0 });
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
  }, [currentSpeedPreset]);


  useEffect(() => {
    Animated.timing(menuAnim, {
      toValue: menuVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [menuAnim, menuVisible]);

  const menuWidth = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, s(520)],
  });

  // Double tap/click on a tile toggles it between the 2x2 grid and full screen.
  const handleTileTap = (key: FeedTileKey) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.key === key && now - last.at < 350) {
      setExpandedTile((current) => (current === key ? null : key));
      lastTapRef.current = { key: null, at: 0 };
    } else {
      lastTapRef.current = { key, at: now };
    }
  };

  const cameraStatus = getFeedStatus(cameraFeed, 'CAM', mediaConnected, mediaError, Date.now());
  const lidarStatus = lidarData ? `LIDAR ${lidarData.count} pts` : mediaConnected ? 'LIDAR esperando' : 'LIDAR offline';
  // Camera state reported by the Raspy gateway: telemetry.media.thermal.
  const thermalTelemetry = ((telemetry?.media as any)?.thermal ?? null) as
    { connected?: boolean; error?: string | null } | null;
  const thermalStatus = !mediaConnected
    ? 'offline'
    : thermalInfo.lastFrameAt && !thermalInfo.stale
      ? `live · ${thermalInfo.fps} fps`
      : thermalTelemetry?.error
        ? `error: ${stringifyShort(thermalTelemetry.error, 40)}`
        : thermalTelemetry?.connected === false
          ? 'cámara desconectada'
          : thermalInfo.stale
            ? 'señal interrumpida'
            : 'esperando';
  const safetyReadout = getSafetyReadout(telemetry);

  // Elements, not components: a new component identity per render would
  // remount the feed (and wipe the video canvas) on every state update.
  const feedTiles: { key: FeedTileKey; label: string; status: string; content: React.ReactNode }[] = [
    {
      key: 'cam',
      label: 'CÁMARA',
      status: cameraStatus,
      content: <CameraFeed feed={cameraFeed} status={cameraStatus} showBadge={false} />,
    },
    {
      key: 'lidar',
      label: 'LIDAR',
      status: lidarStatus,
      content: <LidarFeed lidarData={lidarData} sinkRef={lidarSinkRef} status={lidarStatus} showBadge={false} />,
    },
    { key: 'thermal', label: 'TÉRMICA', status: thermalStatus, content: <ThermalFeed info={thermalInfo} /> },
    { key: 'ir', label: 'INFRARROJA', status: 'sin señal', content: <NoSignalFeed /> },
  ];
  const severityColor = (s: number) => {
    if (s <= 3) return '#22c55e';
    if (s <= 6) return '#f59e0b';
    if (s <= 8) return '#f97316';
    return '#f23b3f';
  };

  const pickFile = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          setSelectedFile(file);
          setPreviewUri(URL.createObjectURL(file));
          setAnalysisResult(null);
        }
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso', 'Necesitamos acceso a tu galería para seleccionar fotos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setSelectedFile({ uri: asset.uri, type: asset.mimeType ?? 'image/jpeg', name: 'photo.jpg' });
        setPreviewUri(asset.uri);
        setAnalysisResult(null);
      }
    }
  };

  const analyzeImage = async () => {
    if (!selectedFile || !previewUri) return;
    setAnalyzing(true);
    try {
      const result = await analyzeBuilding(selectedFile);
      setAnalysisResult(result);
      setEdificios(prev => [...prev, {
        nombre: `edificio_${prev.length + 1}`,
        previewUri,
        analysis: result,
      }]);
    } catch {
      Alert.alert('Error', 'No se pudo conectar con el servidor de análisis');
    } finally {
      setAnalyzing(false);
    }
  };

  const guardarYSiguiente = () => {
    setPreviewUri(null);
    setSelectedFile(null);
    setAnalysisResult(null);
  };

  const imageToBase64 = async (uri: string): Promise<string> => {
    try {
      const blob = await fetch(uri).then(r => r.blob());
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  };

  const tomarCaptura = useCallback(() => {
    if (Platform.OS !== 'web') {
      Alert.alert('Captura', 'Esta versión todavía permite capturar desde la consola web.');
      return;
    }
    const canvas = document.getElementById('laika-camera-canvas') as HTMLCanvasElement | null;
    const uri = canvas && canvas.width > 0 && canvas.height > 0
      ? canvas.toDataURL('image/jpeg', 0.9)
      : cameraFeed.uri;
    if (!uri) {
      Alert.alert('Captura', 'Esperá a que llegue señal de la cámara para sacar una captura.');
      return;
    }
    const item: MisionGaleriaItem = {
      id: `captura-${Date.now()}`,
      tipo: 'captura',
      creado_at: new Date().toISOString(),
      uri,
    };
    setGaleria((prev) => [...prev, item]);
    addOperatorEvent('mission_screenshot', item.id);
  }, [addOperatorEvent, cameraFeed.uri]);

  const detenerGrabacionPantalla = useCallback(() => {
    screenRecorderRef.current?.stop();
  }, []);

  const alternarGrabacionPantalla = useCallback(async () => {
    if (grabandoPantalla) {
      detenerGrabacionPantalla();
      return;
    }
    if (Platform.OS !== 'web' || !navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      Alert.alert('Grabación', 'La grabación de pantalla está disponible en navegadores web compatibles.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const chunks: BlobPart[] = [];
      const startedAt = Date.now();
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
      screenStreamRef.current = stream;
      screenRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        const durationMs = Date.now() - startedAt;
        setGrabandoPantalla(false);
        screenRecorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
        if (!chunks.length) return;
        try {
          const id = `video-${Date.now()}`;
          const video = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          await saveMissionVideo(id, video);
          setGaleria((prev) => [...prev, { id, tipo: 'video', creado_at: new Date().toISOString(), videoId: id, duracionMs: durationMs }]);
          addOperatorEvent('mission_screen_recording', `${Math.round(durationMs / 1000)}s`);
        } catch (error) {
          Alert.alert('Grabación', 'No se pudo guardar el video en este navegador.');
          addOperatorEvent('mission_screen_recording_error', error instanceof Error ? error.message : String(error));
        }
      };
      stream.getVideoTracks()[0].onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      recorder.start(1000);
      setGrabandoPantalla(true);
      addOperatorEvent('mission_screen_recording_started', 'grabando pantalla');
    } catch (error) {
      if ((error as Error)?.name !== 'NotAllowedError') Alert.alert('Grabación', 'No se pudo iniciar la grabación de pantalla.');
    }
  }, [addOperatorEvent, detenerGrabacionPantalla, grabandoPantalla]);

  useEffect(() => () => {
    if (screenRecorderRef.current?.state === 'recording') screenRecorderRef.current.stop();
    screenStreamRef.current?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#000' }}>

        <View style={{ flex: 1 }}>
          <View style={styles.window}>

            {/* All four tiles stay mounted; expanding just restyles them, so
                the camera canvas never remounts (no black flash). */}
            <View style={styles.feedGrid}>
              {feedTiles.map((tile, index) => {
                const expanded = expandedTile === tile.key;
                const hidden = expandedTile !== null && !expanded;
                return (
                  <Pressable
                    key={tile.key}
                    onPress={() => handleTileTap(tile.key)}
                    style={[
                      styles.feedTile,
                      index % 2 === 0 && styles.feedTileLeftCol,
                      index < 2 && styles.feedTileTopRow,
                      expanded && styles.feedTileExpanded,
                      hidden && styles.feedTileHidden,
                    ]}
                  >
                    {tile.content}
                    <View
                      pointerEvents="none"
                      style={[
                        styles.feedLabel,
                        // Labels sit at the corner nearest the screen center,
                        // away from the header and the joysticks.
                        expanded ? styles.feedLabelExpanded : FEED_LABEL_CORNERS[index],
                      ]}
                    >
                      <Text style={styles.feedLabelText}>{tile.label}</Text>
                      <Text style={styles.feedLabelStatus}>
                        {tile.status}{expanded ? ' · doble toque para volver' : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.hudHeader}>
              <View style={styles.leftHudGroup}>
                <Pressable
                  onPress={() => setExitConfirmVisible(true)}
                  onHoverIn={() => setHomeHovered(true)}
                  onHoverOut={() => setHomeHovered(false)}
                  style={({ pressed }) => [
                    styles.btnBack,
                    (pressed || homeHovered) && styles.btnBackActive,
                  ]}
                >
                  {({ pressed }) => (
                    <Text style={[styles.btnText, (pressed || homeHovered) && styles.btnTextActive]}>HOME</Text>
                  )}
                </Pressable>
                {expandedTile && (
                  <TouchableOpacity activeOpacity={0.8} onPress={() => setExpandedTile(null)} style={styles.btnFullScreen}>
                    <Text style={styles.btnText}>4 VISTAS</Text>
                  </TouchableOpacity>
                )}

              <View style={styles.telemetryContainer}>
                <Text style={styles.telemetryText}>
                  UNITREE 02 | BATT {robotStatus ? `${robotStatus.battery}%` : '85%'} |
                </Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setIsExtraFeature(!isExtraFeature)}
                  style={[styles.lockButton, isExtraFeature && styles.lockButtonActive]}
                >
                  <PadlockIcon open={isExtraFeature} />
                </TouchableOpacity>
              </View>
              </View>

              <View style={styles.rightHudGroup}>
                <TouchableOpacity activeOpacity={0.8} onPress={() => setAiVisible(true)} style={styles.buildingsButton}>
                  <Text style={styles.buildingsButtonText}>EDIFICIOS</Text>
                </TouchableOpacity>
              </View>
          </View>

            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.stopButton}
              onPress={() => emergencyStop().catch(() => {})}
            >
              <Text style={styles.stopButtonText}>STOP</Text>
            </TouchableOpacity>

            <View style={styles.controlsOverlay} pointerEvents="box-none">
              {joystickEnabled ? <JoystickLeft /> : <DPad />}

              <View style={styles.actionBar}>
                {([
                  { label: 'MENU', onPress: () => setMenuVisible(!menuVisible), active: menuVisible },
                  { label: 'WALKIE', onPress: () => Alert.alert('Walkie', 'Todavía no está disponible.') },
                  {
                    label: grabandoPantalla ? '● REC' : 'FOTO/VIDEO',
                    // Tap = foto, mantener = empezar/terminar grabación.
                    onPress: grabandoPantalla ? alternarGrabacionPantalla : tomarCaptura,
                    onLongPress: alternarGrabacionPantalla,
                    active: grabandoPantalla,
                  },
                  { label: 'LINTERNA', onPress: () => Alert.alert('Linterna', 'Todavía no está disponible.') },
                ] as { label: string; onPress: () => void; onLongPress?: () => void; active?: boolean }[]).map((action) => (
                  <View key={action.label} style={styles.actionButton}>
                    <Text style={styles.actionSeparator}>|</Text>
                    <TouchableOpacity activeOpacity={0.7} onPress={action.onPress} onLongPress={action.onLongPress}>
                      <Text style={[styles.actionButtonText, action.active && styles.actionButtonTextActive]}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              {joystickEnabled ? <JoystickRight /> : <DPad />}
            </View>

          </View>
        </View>

        <Animated.View style={[styles.pushMenu, { width: menuWidth }]}>
          {menuVisible && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: s(16) }} showsVerticalScrollIndicator={false}>
              <TouchableOpacity onPress={() => setMenuVisible(false)} style={styles.menuCloseButton}>
                <Text style={{ color: 'white', fontSize: 22 }}>→</Text>
                <Text style={{ color: 'white', fontWeight: 'bold', marginLeft: 10 }}>MENÚ</Text>
              </TouchableOpacity>
              <View style={{ width: '100%', height: 1, backgroundColor: '#222', marginBottom: 12 }} />

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginBottom: 4 }]}>CONEXIÓN / MEDIA</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <StatusBadge text={`API 10.40.5.4:8000`} mode="ok" />
                  <StatusBadge text={mediaConnected ? 'WS conectado' : 'WS offline'} mode={mediaConnected ? 'ok' : 'err'} />
                </View>
                <View style={styles.operatorRow}>
                  <StatusBadge text={`BW ${netStats.total} kbps`} mode={netStats.total > 0 ? 'ok' : 'muted'} />
                  <StatusBadge text={`video ${netStats.video}`} />
                  <StatusBadge text={`lidar ${netStats.lidar}`} />
                  <StatusBadge text={`audio ${netStats.audio}`} />
                </View>
                <View style={styles.profileRow}>
                  {(Object.keys(NETWORK_PROFILES) as NetworkProfileKey[]).map((profile) => (
                    <TouchableOpacity
                      key={profile}
                      style={[styles.profileButton, networkProfile === profile && styles.profileButtonActive]}
                      onPress={() => selectNetworkProfile(profile)}
                    >
                      <Text style={[styles.profileButtonText, networkProfile === profile && styles.profileButtonTextActive]}>
                        {NETWORK_PROFILES[profile].label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.operatorSwitchRow}>
                  <Text style={styles.operatorSwitchLabel}>VIDEO</Text>
                  <Switch
                    value={mediaSettings.video}
                    onValueChange={(video) => setMediaSettings((prev) => ({ ...prev, video }))}
                    trackColor={{ false: '#333', true: 'rgba(242, 59, 63, 0.35)' }}
                    thumbColor={mediaSettings.video ? '#f23b3f' : '#666'}
                  />
                  <Text style={styles.operatorSwitchLabel}>LIDAR</Text>
                  <Switch
                    value={mediaSettings.lidar}
                    onValueChange={(lidar) => setMediaSettings((prev) => ({ ...prev, lidar }))}
                    trackColor={{ false: '#333', true: 'rgba(242, 59, 63, 0.35)' }}
                    thumbColor={mediaSettings.lidar ? '#f23b3f' : '#666'}
                  />
                  <Text style={styles.operatorSwitchLabel}>AUDIO</Text>
                  <Switch
                    value={mediaSettings.audio}
                    onValueChange={(audio) => setMediaSettings((prev) => ({ ...prev, audio }))}
                    trackColor={{ false: '#333', true: 'rgba(242, 59, 63, 0.35)' }}
                    thumbColor={mediaSettings.audio ? '#f23b3f' : '#666'}
                  />
                </View>
                <View style={styles.numberGrid}>
                  <NumberField label="Cam FPS" value={mediaSettings.cameraFps} min={1} max={40} onChange={(cameraFps) => setMediaSettings((prev) => ({ ...prev, cameraFps }))} />
                  <NumberField label="Calidad %" value={mediaSettings.cameraQuality} min={25} max={90} onChange={(cameraQuality) => setMediaSettings((prev) => ({ ...prev, cameraQuality }))} />
                  <NumberField label="Ancho" value={mediaSettings.cameraWidth} min={320} max={1920} step={80} onChange={(cameraWidth) => setMediaSettings((prev) => ({ ...prev, cameraWidth }))} />
                  <NumberField label="Bitrate" value={mediaSettings.cameraBitrateKbps} min={100} max={12000} step={100} onChange={(cameraBitrateKbps) => setMediaSettings((prev) => ({ ...prev, cameraBitrateKbps }))} />
                </View>
                <View style={styles.numberGrid}>
                  <NumberField label="Audio every" value={mediaSettings.audioEmitEvery} min={1} max={10} onChange={(audioEmitEvery) => setMediaSettings((prev) => ({ ...prev, audioEmitEvery }))} />
                  <NumberField label="Audio bytes" value={mediaSettings.audioMaxBytes} min={0} max={262144} step={4096} onChange={(audioMaxBytes) => setMediaSettings((prev) => ({ ...prev, audioMaxBytes }))} />
                </View>
                <View style={styles.operatorRow}>
                  <OperatorButton label="APLICAR MEDIA" tone="ok" onPress={() => applyMediaSettings()} />
                  <StatusBadge text={mediaApplyStatus} mode={mediaApplyStatus.includes('error') ? 'err' : 'ok'} />
                </View>
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>VELOCIDAD / CONTROL</Text>
              <View style={styles.speedRow}>
                <TouchableOpacity style={styles.speedBtn} onPress={() => setRobotSpeed(Math.max(10, robotSpeed - 10))}>
                  <Text style={styles.stopHudText}>−</Text>
                </TouchableOpacity>
                <View style={styles.speedBar}>
                  <View style={[styles.speedFill, { width: `${robotSpeed}%` as any }]} />
                </View>
                <TouchableOpacity style={styles.speedBtn} onPress={() => setRobotSpeed(Math.min(100, robotSpeed + 10))}>
                  <Text style={styles.stopHudText}>+</Text>
                </TouchableOpacity>
                <Text style={styles.speedValue}>{robotSpeed}%</Text>
              </View>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <StatusBadge text={`perfil ${speedProfile}`} mode={speedProfile === 'max_api' ? 'warn' : 'ok'} />
                  <StatusBadge text={`vx ${requestedMove.x.toFixed(2)} · vy ${requestedMove.y.toFixed(2)} · yaw ${requestedMove.z.toFixed(2)}`} />
                </View>
                <View style={styles.operatorRow}>
                  <OperatorButton label="PERFIL NORMAL" onPress={() => requestSpeedMode('normal')} disabled={speedProfile === 'normal'} />
                  <OperatorButton label="MÁXIMO API" tone="danger" onPress={() => requestSpeedMode('max_api')} disabled={speedProfile === 'max_api'} />
                  <OperatorButton label="MODO MANUAL" onPress={() => sendDogCommand('enter_mode', { mode: 'normal' }).then(() => addOperatorEvent('manual_mode', 'normal')).catch((error) => addOperatorEvent('manual_mode_error', error instanceof Error ? error.message : String(error)))} />
                </View>
                <Text style={styles.operatorHint}>Teclado web: W/A/S/D, flechas, Q/E lateral, numpad 1/2/3/4/6 y Space para STOP.</Text>
              </View>

              {/* ── Navegación autónoma ── */}
              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>NAVEGACIÓN AUTÓNOMA</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <OperatorButton label="EXPLORAR" tone="ok" onPress={() => runAutonomyAction('start')} disabled={autoMode} />
                  <OperatorButton label="DETENER" tone="warn" onPress={() => runAutonomyAction('stop')} />
                  <OperatorButton label="PARADA" tone="danger" onPress={() => { setAutoMode(false); runAutonomyAction('estop'); emergencyStop().catch(() => {}); }} />
                </View>
                <View style={styles.operatorRow}>
                  <StatusBadge text={`estado ${autonomyInfo.status}`} mode={autonomyInfo.running ? 'ok' : 'muted'} />
                  <StatusBadge text={`cobertura ${autonomyInfo.coverage == null ? '--' : `${Math.round(autonomyInfo.coverage * 100)}%`}`} />
                  <StatusBadge text={`capturas ${autonomyInfo.captures}`} />
                </View>
                <View style={styles.operatorRow}>
                  <StatusBadge text={`meta ${autonomyInfo.goal ?? '--'}`} />
                  <OperatorButton label={greeterOn ? 'SALUDO ON' : 'SALUDO OFF'} onPress={toggleGreeter} />
                  <OperatorButton label="PROBAR SALUDO" onPress={() => testDogGreeting().then(() => setGreeterStatus('saludo enviado')).catch(() => setGreeterStatus('saludo: error'))} />
                </View>
                <StatusBadge text={greeterStatus} mode={greeterStatus.includes('error') ? 'err' : greeterStatus.includes('listo') ? 'ok' : 'muted'} />
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>SEGURIDAD ANTI-CHOQUE</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <StatusBadge text={`guard ${safetyReadout.guard}`} mode={safetyReadout.guardOk ? 'ok' : 'warn'} />
                  <StatusBadge text={`frente ${safetyReadout.front}`} mode={safetyReadout.frontDanger ? 'err' : 'muted'} />
                  <StatusBadge text={`borde ${safetyReadout.cliff}`} mode={safetyReadout.cliffDanger ? 'err' : 'ok'} />
                </View>
                <StatusBadge text={`L/R/atrás ${safetyReadout.sides}`} />
                <StatusBadge text={`última intervención ${safetyReadout.last}`} />
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>COLOR DE CÁMARA EN LIDAR</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorSwitchRow}>
                  <Text style={styles.operatorSwitchLabel}>COLORIZAR</Text>
                  <Switch
                    value={colorCalibration.enabled}
                    onValueChange={(enabled) => setColorCalibration((prev) => ({ ...prev, enabled }))}
                    trackColor={{ false: '#333', true: 'rgba(242, 59, 63, 0.35)' }}
                    thumbColor={colorCalibration.enabled ? '#f23b3f' : '#666'}
                  />
                </View>
                <View style={styles.numberGrid}>
                  <NumberField label="FOV" value={colorCalibration.fovDeg} min={60} max={210} onChange={(fovDeg) => setColorCalibration((prev) => ({ ...prev, fovDeg }))} />
                  <NumberField label="Pitch" value={colorCalibration.pitchDeg} min={-45} max={45} onChange={(pitchDeg) => setColorCalibration((prev) => ({ ...prev, pitchDeg }))} />
                  <NumberField label="Altura" value={colorCalibration.heightM} min={-0.5} max={1.5} step={0.05} decimals={2} onChange={(heightM) => setColorCalibration((prev) => ({ ...prev, heightM }))} />
                  <NumberField label="Adelante" value={colorCalibration.forwardM} min={-0.5} max={1.5} step={0.05} decimals={2} onChange={(forwardM) => setColorCalibration((prev) => ({ ...prev, forwardM }))} />
                </View>
                <OperatorButton label="APLICAR COLOR" tone="ok" onPress={applyColor} />
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>LIDAR EN VIVO / SESIÓN</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <StatusBadge text={lidarData ? `${lidarData.count.toLocaleString()} pts` : 'sin nube'} mode={lidarData ? 'ok' : 'muted'} />
                  <StatusBadge text={`${recordedFrames} cuadros grabados`} mode={recordingLidar ? 'warn' : 'muted'} />
                </View>
                <View style={styles.operatorRow}>
                  <OperatorButton label="LIMPIAR" onPress={clearLiveLidar} />
                  <OperatorButton label={recordingLidar ? 'DETENER REC' : 'GRABAR'} tone={recordingLidar ? 'warn' : 'default'} onPress={toggleLidarRecording} />
                  <OperatorButton label="REPLAY" onPress={replayLidarRecording} disabled={!recordedFrames} />
                  <OperatorButton label="EXPORTAR" onPress={exportLidarRecording} disabled={!recordedFrames} />
                </View>
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>BIBLIOTECA DE MAPAS / MODELO 3D</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <OperatorButton label="ACTUALIZAR" onPress={refreshMaps} />
                  <OperatorButton label="SNAPSHOT" tone="ok" onPress={saveSnapshot} />
                  <OperatorButton label="ABRIR MAPA" onPress={openSelectedMap} disabled={!selectedMapId} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(6), paddingVertical: s(4) }}>
                  {maps.length ? maps.map((map) => (
                    <TouchableOpacity
                      key={map.map_id}
                      style={[styles.mapChoice, selectedMapId === map.map_id && styles.mapChoiceActive]}
                      onPress={() => setSelectedMapId(map.map_id)}
                    >
                      <Text style={[styles.mapChoiceText, selectedMapId === map.map_id && styles.mapChoiceTextActive]}>
                        {formatDogMapLabel(map)}
                      </Text>
                    </TouchableOpacity>
                  )) : (
                    <Text style={styles.operatorHint}>sin mapas consultados</Text>
                  )}
                </ScrollView>
                <StatusBadge text={mapStatus} mode={mapStatus.includes('error') ? 'err' : loadedMap ? 'ok' : 'muted'} />
                <MapPreview map={loadedMap} />
                <View style={styles.operatorRow}>
                  <OperatorButton label="CARGAR MODELO" onPress={refreshMesh} />
                  <OperatorButton label="RECONSTRUIR" tone="warn" onPress={rebuildMesh} />
                </View>
                <StatusBadge
                  text={meshSummary ? `${meshSummary.vertexCount.toLocaleString()} vértices · ${meshSummary.faceCount.toLocaleString()} caras` : meshStatus}
                  mode={meshStatus.includes('error') ? 'err' : meshSummary ? 'ok' : 'muted'}
                />
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>CARAS CAPTURADAS</Text>
              <View style={styles.operatorSection}>
                <View style={styles.operatorRow}>
                  <OperatorButton label="ACTUALIZAR" onPress={refreshFaces} />
                  <OperatorButton label="BORRAR TODAS" tone="danger" onPress={purgeFacesAction} />
                </View>
                <StatusBadge text={perceptionStatus} mode={perceptionStatus.includes('ON') ? 'ok' : 'warn'} />
                <StatusBadge text={facesStatus} mode={faces.length ? 'ok' : 'muted'} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(8), paddingTop: s(8) }}>
                  {faces.length ? faces.map((face) => (
                    <TouchableOpacity key={face.person_id} style={styles.faceCard} onPress={() => labelFace(face)}>
                      <Image source={{ uri: dogFaceImageUrl(face.person_id) }} style={styles.faceImage} resizeMode="cover" />
                      <Text style={styles.faceLabel} numberOfLines={1}>{face.label || face.person_id}</Text>
                      <Text style={styles.faceMeta}>{face.known ? 'conocida' : 'nueva'} · {face.captures ?? 0}</Text>
                    </TouchableOpacity>
                  )) : (
                    <Text style={styles.operatorHint}>sin caras capturadas</Text>
                  )}
                </ScrollView>
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>TELEMETRÍA</Text>
              <View style={styles.telemetryBox}>
                {telemetry ? (
                  Object.entries(telemetry).slice(0, 12).map(([k, v]) => (
                    <Text key={k} style={styles.telemetryLine}>{k}: {JSON.stringify(v)}</Text>
                  ))
                ) : (
                  <Text style={styles.telemetryLine}>sin datos — conectando…</Text>
                )}
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>EVENTOS / ACK / PREDICCIONES</Text>
              <View style={styles.telemetryBox}>
                {operatorEvents.length ? operatorEvents.slice(0, 18).map((event) => (
                  <Text key={event.id} style={styles.telemetryLine}>
                    <Text style={{ color: '#6f5a5a' }}>{event.ts}</Text> {event.type}: {stringifyShort(event.data)}
                  </Text>
                )) : (
                  <Text style={styles.telemetryLine}>sin eventos todavía</Text>
                )}
              </View>

              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>EDIFICIOS ANALIZADOS</Text>
              {edificios.length === 0 ? (
                <Text style={{ color: '#433838', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                  Sin edificios analizados
                </Text>
              ) : (
                [...edificios].reverse().map((e) => (
                  <View key={e.nombre} style={styles.edificioCard}>
                    <View style={styles.edificioCardHeader}>
                      <Image source={{ uri: e.previewUri }} style={styles.edificioThumb} resizeMode="cover" />
                      <View style={styles.edificioInfo}>
                        <Text style={styles.edificioName}>{e.nombre}</Text>
                        <View style={[styles.edificioBadge, { backgroundColor: severityColor(e.analysis.nivel_severidad_general) }]}>
                          <Text style={styles.edificioBadgeText}>{e.analysis.nivel_severidad_general}/10 · {e.analysis.grado_general}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.damagesRow}>
                      {(e.analysis.daños_detectados ?? []).slice(0, 3).map((d, i) => (
                        <View key={i} style={styles.damageChip}>
                          <Text style={styles.damageChipText}>{d.tipo}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.edificioResumen} numberOfLines={3}>{e.analysis.resumen}</Text>
                  </View>
                ))
              )}
              <View style={{ height: 24 }} />
            </ScrollView>
          )}
        </Animated.View>

      </View>

      <Modal animationType="fade" transparent visible={exitConfirmVisible} onRequestClose={() => setExitConfirmVisible(false)}>
        <Pressable style={styles.aiModalOverlay} onPress={() => setExitConfirmVisible(false)}>
          <Pressable style={[styles.aiModal, { width: 340 }]}>
            <Text style={[styles.aiModalTitle, { marginBottom: 10 }]}>¿Salir de la misión?</Text>
            <Text style={{ color: '#8b7474', fontFamily: 'monospace', fontSize: 13, marginBottom: 20 }}>
              Se guardarán los edificios y {galeria.length} archivo(s) de la galería.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.analyzeButton, { flex: 1, borderColor: '#433838' }]}
                onPress={() => setExitConfirmVisible(false)}
              >
                <Text style={[styles.analyzeButtonText, { color: '#8b7474' }]}>CANCELAR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.analyzeButton, { flex: 1 }]}
                onPress={async () => {
                  if (grabandoPantalla) {
                    Alert.alert('Grabación en curso', 'Detené la grabación y esperá a que se guarde antes de salir de la misión.');
                    return;
                  }
                  setExitConfirmVisible(false);
                  if (misionActiva && misionActiva.id > 0) {
                    try {
                      const edificiosConFoto = await Promise.all(
                        edificios.map(async (e) => ({
                          ...e,
                          previewUri: await imageToBase64(e.previewUri),
                        }))
                      );
                      await finalizarMision(misionActiva.id, edificiosConFoto, galeria);
                    } catch {}
                  }
                  setMisionActiva(null);
                  router.replace('/');
                }}
              >
                <Text style={styles.analyzeButtonText}>SALIR Y GUARDAR</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={aiVisible} onRequestClose={() => setAiVisible(false)}>
        <Pressable style={styles.aiModalOverlay} onPress={() => setAiVisible(false)}>
          <Pressable style={styles.aiModal}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.aiModalHeader}>
                <Text style={styles.aiModalTitle}>ANÁLISIS IA</Text>
                <TouchableOpacity style={styles.aiModalClose} onPress={() => setAiVisible(false)}>
                  <MaterialIcons name="close" size={s(18)} color="#f23b3f" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity activeOpacity={0.8} style={styles.uploadArea} onPress={pickFile}>
                {previewUri ? (
                  <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
                ) : (
                  <>
                    <MaterialIcons name="cloud-upload" size={s(36)} color="#6a4a4b" />
                    <Text style={styles.uploadText}>Subir foto del edificio</Text>
                  </>
                )}
              </TouchableOpacity>

              {selectedFile && !analyzing && (
                <TouchableOpacity activeOpacity={0.8} style={styles.analyzeButton} onPress={analyzeImage}>
                  <Text style={styles.analyzeButtonText}>ANALIZAR</Text>
                </TouchableOpacity>
              )}

              {analyzing && <ActivityIndicator color="#f23b3f" style={{ marginVertical: 12 }} />}

              {analysisResult && (
                <View style={styles.resultsContainer}>
                  <View style={styles.severityRow}>
                    <Text style={styles.severityLabel}>SEVERIDAD</Text>
                    <View style={[styles.severityBadge, { backgroundColor: severityColor(analysisResult.nivel_severidad_general) }]}>
                      <Text style={styles.severityValue}>{analysisResult.nivel_severidad_general}/10</Text>
                    </View>
                  </View>

                  <Text style={styles.gradeText}>{analysisResult.grado_general}</Text>

                  <View style={styles.damagesRow}>
                    {(analysisResult.daños_detectados ?? []).map((d: DañoDetectado, i: number) => (
                      <View key={i} style={styles.damageChip}>
                        <Text style={styles.damageChipText}>{d.tipo} · {d.severidad}/10</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.summaryText}>{analysisResult.resumen}</Text>

                  <TouchableOpacity activeOpacity={0.8} style={styles.siguienteButton} onPress={guardarYSiguiente}>
                    <Text style={styles.siguienteButtonText}>SIGUIENTE →</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </GestureHandlerRootView>
  );
}
