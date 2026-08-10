import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Pressable,
  Text,
  Dimensions,
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
import {
  PanGestureHandler,
  GestureHandlerRootView,
  State,
  PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ScreenOrientation from 'expo-screen-orientation';

import { styles } from '../styles/misionStyles';
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
  emergencyStop,
  autonomousStart,
  autonomousStop,
  sendDogCommand,
} from '../services/api';
import {
  connectRobotWS,
  registerVideoCanvas,
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
const { width } = Dimensions.get('window');

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

  return (
    <View style={[{ backgroundColor: '#0a0a0a', overflow: 'hidden' }, style]}>
      {dots.length > 0 ? (
        <Svg width={W} height={H}>
          {dots.map((d, i) => (
            <Circle key={i} cx={d.cx} cy={d.cy} r={1.2} fill="#00e676" opacity={0.85} />
          ))}
        </Svg>
      ) : (
        <Text style={{ color: '#333', alignSelf: 'center', marginTop: H / 2 - 8, fontSize: 11 }}>
          LIDAR
        </Text>
      )}
      <View style={{ position: 'absolute', bottom: 4, left: 6 }}>
        <Text style={{ color: '#00e676', fontSize: 9, fontFamily: 'monospace' }}>{status}</Text>
      </View>
    </View>
  );
});
LidarMapView.displayName = 'LidarMapView';

const LiveFeed = ({
  feed,
  label,
  status,
  lidar = false,
}: {
  feed: VisualFeedState;
  label: string;
  status: string;
  lidar?: boolean;
}) => (
  <View style={[styles.videoStreamContainer, lidar && styles.lidarStreamContainer]}>
    {feed.uri ? (
      <Image source={{ uri: feed.uri }} style={styles.liveFeedImage} resizeMode="cover" />
    ) : (
      <Text style={lidar ? styles.lidarPlaceholderText : styles.videoPlaceholderText}>
        {label}
      </Text>
    )}
    <View style={styles.feedBadge}>
      <Text style={styles.feedBadgeText}>{status}</Text>
    </View>
  </View>
);

const CameraFeed = ({
  feed,
  label,
  status,
}: {
  feed: VisualFeedState;
  label: string;
  status: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;
    return registerVideoCanvas(canvasRef.current);
  }, []);

  if (Platform.OS !== 'web') {
    return <LiveFeed feed={feed} label={label} status={status} />;
  }

  return (
    <View style={styles.videoStreamContainer}>
      {React.createElement('canvas', {
        ref: canvasRef,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          backgroundColor: '#000',
        },
      })}
      {!feed.lastFrameAt && (
        <View style={styles.cameraPlaceholderOverlay} pointerEvents="none">
          <Text style={styles.videoPlaceholderText}>{label}</Text>
        </View>
      )}
      <View style={styles.feedBadge}>
        <Text style={styles.feedBadgeText}>{status}</Text>
      </View>
    </View>
  );
};

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
  const { joystickEnabled, misionActiva, setMisionActiva, robotSpeed, setRobotSpeed } = useAppSettings();
  const [isExtraFeature, setIsExtraFeature] = useState(false);
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);

  const [isCameraMain, setIsCameraMain] = useState(true);
  const [isSplit, setIsSplit] = useState(false);
  const [splitSide, setSplitSide] = useState<'left' | 'right'>('right');
  const [dragging, setDragging] = useState(false);
  const [previewSide, setPreviewSide] = useState<'left' | 'right' | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [homeHovered, setHomeHovered] = useState(false);
  const [fullHovered, setFullHovered] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [aiVisible, setAiVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [edificios, setEdificios] = useState<Edificio[]>([]);
  const [cameraFeed, setCameraFeed] = useState<VisualFeedState>({ uri: null, lastFrameAt: 0 });
  const [mediaConnected, setMediaConnected] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Record<string, unknown> | null>(null);
  const [lidarData, setLidarData] = useState<{ points: Float32Array; count: number } | null>(null);
  const [activeBottomTab, setActiveBottomTab] = useState<'lidar' | 'telemetry' | 'status'>('lidar');
  const [operatorEvents, setOperatorEvents] = useState<OperatorEvent[]>([]);
  const [networkProfile, setNetworkProfile] = useState<NetworkProfileKey>('weak');
  const [mediaSettings, setMediaSettings] = useState<Omit<DogMediaSettings, 'profile'>>(() => ({
    video: true,
    lidar: true,
    audio: false,
    cameraFps: NETWORK_PROFILES.weak.cameraFps,
    cameraQuality: NETWORK_PROFILES.weak.cameraQuality,
    cameraWidth: NETWORK_PROFILES.weak.cameraWidth,
    cameraBitrateKbps: NETWORK_PROFILES.weak.cameraBitrateKbps,
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
  const lastTelemetryRef = useRef(0);
  const lastLidarRef = useRef(0);
  const netBytesRef = useRef({ video: 0, lidar: 0, audio: 0 });
  const keyStateRef = useRef<Set<string>>(new Set());
  const mediaSettingsRef = useRef(mediaSettings);
  const networkProfileRef = useRef(networkProfile);
  const lidarRecordRef = useRef<{ recording: boolean; startedAt: number; frames: { t: number; points: Float32Array; count: number }[] }>({
    recording: false,
    startedAt: 0,
    frames: [],
  });
  const [autoMode, setAutoMode] = useState(false);

  const menuAnim = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  const addOperatorEvent = useCallback((type: string, data: unknown) => {
    setOperatorEvents((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ts: new Date().toLocaleTimeString('es-AR'),
        type,
        data,
      },
      ...prev,
    ].slice(0, 80));
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
    addOperatorEvent('lidar_replay', `${frames.length} cuadros`);
    const started = Date.now();
    let index = 0;
    const tick = () => {
      const elapsed = Date.now() - started;
      while (index < frames.length && frames[index].t <= elapsed) {
        setLidarData({ points: frames[index].points, count: frames[index].count });
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
        if (now - lastVideoRef.current < 66) return;
        lastVideoRef.current = now;
        setCameraFeed({ uri, lastFrameAt: now });
      },
      onVideoTick: () => {

        const now = Date.now();
        if (now - lastVideoRef.current < 200) return;
        lastVideoRef.current = now;
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
      onLidar: (points, count) => {
        const now = Date.now();
        if (now - lastLidarRef.current < 200) return;
        lastLidarRef.current = now;
        setLidarData({ points, count });
        const rec = lidarRecordRef.current;
        if (rec.recording) {
          rec.frames.push({ t: now - rec.startedAt, points: points.slice(0), count });
          if (rec.frames.length > 1200) rec.frames.shift();
          setRecordedFrames(rec.frames.length);
        }
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
    });
    return disconnect;
  }, [addOperatorEvent, refreshCapabilities, refreshFaces, refreshMaps, refreshMesh, updateAutonomyFromMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      const bytes = netBytesRef.current;
      setNetStats({
        video: Math.round((bytes.video * 8) / 1000),
        lidar: Math.round((bytes.lidar * 8) / 1000),
        audio: Math.round((bytes.audio * 8) / 1000),
        total: Math.round(((bytes.video + bytes.lidar + bytes.audio) * 8) / 1000),
      });
      netBytesRef.current = { video: 0, lidar: 0, audio: 0 };
      if (mediaConnected) sendRobotHeartbeat();
    }, 1000);
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
        if (!sendRobotDrive(x, y, z, 360)) moveRobotAxes(x, y, z, 360).catch(() => {});
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

    const loop = setInterval(sendDrive, 90);

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

  const exitSplit = () => {
    setIsSplit(false);
    dragX.setValue(0);
    dragY.setValue(0);
  };

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: dragX, translationY: dragY } }],
    {
      useNativeDriver: false,
      listener: (event: any) => {
        const absX = event.nativeEvent.absoluteX;
        const screenW = menuVisible ? width - s(520) : width;
        if (absX < screenW * 0.4) {
          setPreviewSide('left');
        } else if (absX > screenW * 0.6) {
          setPreviewSide('right');
        } else {
          setPreviewSide(null);
        }
      },
    }
  );

  const onPipStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.BEGAN) {
      setDragging(true);
    }
    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.CANCELLED) {
      const absX = event.nativeEvent.absoluteX;
      const screenW = menuVisible ? width - s(520) : width;

      if (absX < screenW * 0.4) {
        setSplitSide('left');
        setIsSplit(true);
      } else if (absX > screenW * 0.6) {
        setSplitSide('right');
        setIsSplit(true);
      }

      Animated.spring(dragX, { toValue: 0, useNativeDriver: false }).start();
      Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
      setDragging(false);
      setPreviewSide(null);
    }
  };

  const onSplitStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.END) {
      if (Math.abs(event.nativeEvent.translationX) > 120) {
        exitSplit();
      }
    }
  };

  const cameraStatus = getFeedStatus(cameraFeed, 'CAM', mediaConnected, mediaError, Date.now());
  const lidarStatus = lidarData ? `LIDAR ${lidarData.count} pts` : mediaConnected ? 'LIDAR esperando' : 'LIDAR offline';
  const safetyReadout = getSafetyReadout(telemetry);

  const CamView = useCallback(
    () => (
      <CameraFeed
        feed={cameraFeed}
        label="[ CAMARA GO2 ]"
        status={cameraStatus}
      />
    ),
    [cameraFeed, cameraStatus]
  );

  const LidarView = useCallback(
    () => (
      <LiveFeed
        feed={{ uri: null, lastFrameAt: 0 }}
        label="[ LIDAR GO2 ]"
        status={lidarStatus}
        lidar
      />
    ),
    [lidarStatus]
  );

  const MainFeed = isCameraMain ? CamView : LidarView;
  const PipFeed  = isCameraMain ? LidarView : CamView;
  const LeftFeed  = splitSide === 'left'  ? PipFeed : MainFeed;
  const RightFeed = splitSide === 'right' ? PipFeed : MainFeed;
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

  const renderDragPreview = () => {
    if (!dragging || !previewSide) return null;
    return (
      <View style={styles.dragPreviewOverlay} pointerEvents="none">
        <View style={[styles.dragPreviewHalf, previewSide === 'left' ? styles.dragPreviewActive : styles.dragPreviewDim]}>
          <PipFeed />
        </View>
        <View style={[styles.dragPreviewHalf, previewSide === 'right' ? styles.dragPreviewActive : styles.dragPreviewDim]}>
          <MainFeed />
        </View>
      </View>
    );
  };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#000' }}>

        <View style={{ flex: 1 }}>
          <View style={styles.window}>

            {isSplit ? (
              <PanGestureHandler onHandlerStateChange={onSplitStateChange}>
                <View style={styles.splitContainer}>
                  <View style={styles.splitHalf}><LeftFeed /></View>
                  <View style={[styles.splitHalf, styles.splitHalfRight]}><RightFeed /></View>
                </View>
              </PanGestureHandler>
            ) : (
              <>
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                  <MainFeed />
                </View>

                <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onPipStateChange}>
                  <Animated.View style={[styles.pipWindow, { transform: [{ translateX: dragX }, { translateY: dragY }] }]}>
                    <TouchableOpacity style={styles.pipTouchable} onPress={() => setIsCameraMain(!isCameraMain)} activeOpacity={0.85}>
                      <PipFeed />
                      <View style={styles.pipSwapHint}>
                        <Text style={styles.pipSwapText}>TAP TO SWAP</Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                </PanGestureHandler>

                {renderDragPreview()}
              </>
            )}

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
                {isSplit && (
                  <Pressable
                    onPress={exitSplit}
                    onHoverIn={() => setFullHovered(true)}
                    onHoverOut={() => setFullHovered(false)}
                    style={({ pressed }) => [
                      styles.btnFullScreen,
                      (pressed || fullHovered) && styles.btnFullActive,
                    ]}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.btnText, (pressed || fullHovered) && styles.btnTextActive]}>FULL</Text>
                    )}
                  </Pressable>
                )}
              </View>

              <View style={styles.telemetryContainer}>
                <Text style={styles.telemetryText}>
                  UNITREE 02  |  BATT {robotStatus ? `${robotStatus.battery}%` : '—'}  |
                </Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setIsExtraFeature(!isExtraFeature)}
                  style={[styles.lockButton, isExtraFeature && styles.lockButtonActive]}
                >
                  <MaterialIcons
                    name={isExtraFeature ? 'lock-open' : 'lock'}
                    size={s(16)}
                    color="#f23b3f"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.rightHudGroup}>
                <TouchableOpacity
                  style={styles.stopHudBtn}
                  onPress={() => emergencyStop().catch(() => {})}
                >
                  <Text style={styles.stopHudText}>⛔ STOP</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.aiHudButton} onPress={() => setAiVisible(true)}>
                  <MaterialIcons name="auto-awesome" size={s(18)} color="#f23b3f" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMenuVisible(!menuVisible)} style={styles.buildingsButton}>
                  <Text style={styles.buildingsButtonText}>OPERATOR</Text>
                </TouchableOpacity>
              </View>
          </View>

            <View style={styles.controlsOverlay} pointerEvents="box-none">
              {joystickEnabled ? <JoystickLeft /> : <DPad />}

              <View style={styles.actionContainer}>
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#2a1f1f' }}>
                  {(['lidar', 'telemetry', 'status'] as const).map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      style={{ flex: 1, paddingVertical: s(4), alignItems: 'center',
                        borderBottomWidth: activeBottomTab === tab ? 2 : 0,
                        borderColor: '#f23b3f' }}
                      onPress={() => setActiveBottomTab(tab)}
                    >
                      <Text style={{ color: activeBottomTab === tab ? '#f23b3f' : '#555',
                        fontSize: s(9), fontFamily: 'monospace', letterSpacing: 1 }}>
                        {tab === 'lidar' ? 'LIDAR' : tab === 'telemetry' ? 'TELEMETRÍA' : 'ESTADO'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {activeBottomTab === 'lidar' && (
                  <LidarMapView
                    points={lidarData?.points ?? null}
                    count={lidarData?.count ?? 0}
                    status={lidarStatus}
                    style={{ flex: 1, width: '100%' }}
                  />
                )}
                {activeBottomTab === 'telemetry' && (
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: s(4) }}>
                    {telemetry ? (
                      Object.entries(telemetry).slice(0, 16).map(([k, v]) => (
                        <Text key={k} style={{ color: '#aaa', fontFamily: 'monospace', fontSize: s(8), lineHeight: s(13) }}>
                          <Text style={{ color: '#f23b3f' }}>{k}</Text>: {JSON.stringify(v)}
                        </Text>
                      ))
                    ) : (
                      <Text style={{ color: '#444', fontFamily: 'monospace', fontSize: s(9) }}>sin datos — conectando…</Text>
                    )}
                  </ScrollView>
                )}
                {activeBottomTab === 'status' && (
                  <View style={{ flex: 1, padding: s(6) }}>
                    <Text style={{ color: mediaConnected ? '#00e676' : '#f23b3f', fontFamily: 'monospace', fontSize: s(9) }}>
                      WS: {mediaConnected ? 'conectado' : 'desconectado'}
                    </Text>
                    {robotStatus && (
                      <>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: s(9) }}>BATT: {robotStatus.battery}%</Text>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: s(9) }}>VEL máx: {robotStatus.speed} m/s</Text>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: s(9) }}>ROBOT: {robotStatus.status}</Text>
                      </>
                    )}
                    <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: s(9), marginTop: s(4) }}>
                      LIDAR: {lidarData ? `${lidarData.count} pts` : 'sin datos'}
                    </Text>
                  </View>
                )}
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
              Se guardará con todos los edificios analizados.
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
                  setExitConfirmVisible(false);
                  if (misionActiva && misionActiva.id > 0) {
                    try {
                      const edificiosConFoto = await Promise.all(
                        edificios.map(async (e) => ({
                          ...e,
                          previewUri: await imageToBase64(e.previewUri),
                        }))
                      );
                      await finalizarMision(misionActiva.id, edificiosConFoto);
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
