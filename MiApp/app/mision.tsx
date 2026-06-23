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

// Importación de estilos
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
  configureDogVisualStreams,
  emergencyStop,
  autonomousStart,
  autonomousStop,
} from '../services/api';
import { connectRobotWS } from '../services/robotSocket';
import Svg, { Circle } from 'react-native-svg';
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

// ─── Joystick base (shared logic) ────────────────────────────────────────────
function makeJoystick(
  onAxes: (nx: number, ny: number, spd: number) => void,
  onStop: () => void
) {
  return function JoystickBase() {
    const { robotSpeed } = useAppSettings();
    const speedRef = useRef(robotSpeed / 100);
    speedRef.current = robotSpeed / 100;

    const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
    const stickRef = useRef({ x: 0, y: 0 });
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const MAX = s(60);

    const stopFn = useRef(onStop);
    stopFn.current = onStop;
    const axesFn = useRef(onAxes);
    axesFn.current = onAxes;

    const release = useCallback(() => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setStickPos({ x: 0, y: 0 });
      stickRef.current = { x: 0, y: 0 };
      stopFn.current();
    }, []);

    const pan = useRef(PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (timerRef.current) return;
        timerRef.current = setInterval(() => {
          const { x, y } = stickRef.current;
          axesFn.current(x / MAX, y / MAX, speedRef.current);
        }, 180);
      },
      onPanResponderMove: (_, { dx, dy }) => {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const r = dist > MAX ? MAX / dist : 1;
        const pos = { x: dx * r, y: dy * r };
        stickRef.current = pos;
        setStickPos(pos);
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

// Izquierdo: linear_x (adelante/atrás) + linear_y (strafe), sin rotación
const JoystickLeft = makeJoystick(
  (nx, ny, spd) => {
    if (Math.abs(nx) < 0.1 && Math.abs(ny) < 0.1) return;
    const fwdMax = ny < 0 ? 3.5 : 2.3;
    moveRobotAxes(-ny * fwdMax * spd, -nx * 0.92 * spd, 0, 350).catch(() => {});
  },
  () => moveRobotAxes(0, 0, 0).catch(() => {})
);

// Derecho: solo angular_z (giro sobre eje), sin traslación
const JoystickRight = makeJoystick(
  (nx, _ny, spd) => {
    if (Math.abs(nx) < 0.1) return;
    moveRobotAxes(0, 0, -nx * 3.68 * spd, 350).catch(() => {});
  },
  () => moveRobotAxes(0, 0, 0).catch(() => {})
);

// ─── D-Pad component ──────────────────────────────────────────────────────────
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

// ─── LiDAR 2D top-down view ───────────────────────────────────────────────────
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

// ─── Placeholder views ────────────────────────────────────────────────────────
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

// ─── Main Component ───────────────────────────────────────────────────────────
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
  const lastVideoRef = useRef(0);
  const lastTelemetryRef = useRef(0);
  const lastLidarRef = useRef(0);
  const [autoMode, setAutoMode] = useState(false);

  const menuAnim = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  useEffect(() => {
    getRobotStatus().then(setRobotStatus).catch(() => {});
    const interval = setInterval(() => {
      getRobotStatus().then(setRobotStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const disconnect = connectRobotWS({
      onOpen: () => configureDogVisualStreams(true, true).catch(() => {}),
      onVideoFrame: (uri) => {
        const now = Date.now();
        if (now - lastVideoRef.current < 66) return;
        lastVideoRef.current = now;
        setCameraFeed({ uri, lastFrameAt: now });
      },
      onTelemetry: (data) => {
        const now = Date.now();
        if (now - lastTelemetryRef.current < 500) return;
        lastTelemetryRef.current = now;
        setTelemetry(data);
      },
      onLidar: (points, count) => {
        const now = Date.now();
        if (now - lastLidarRef.current < 200) return;
        lastLidarRef.current = now;
        setLidarData({ points, count });
      },
      onStatus: (connected) => {
        setMediaConnected(connected);
        if (!connected) setMediaError('sin señal robot');
        else setMediaError(null);
      },
    });
    return disconnect;
  }, []);


  useEffect(() => {
    Animated.timing(menuAnim, {
      toValue: menuVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [menuAnim, menuVisible]);

  const menuWidth = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, s(400)],
  });

  // ── Helper para salir del split ──────────────────────────────────────────
  const exitSplit = () => {
    setIsSplit(false);
    dragX.setValue(0);
    dragY.setValue(0);
  };

  // ── Gesture: PiP drag ────────────────────────────────────────────────────
  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: dragX, translationY: dragY } }],
    {
      useNativeDriver: false,
      listener: (event: any) => {
        const absX = event.nativeEvent.absoluteX;
        const screenW = menuVisible ? width - s(400) : width;
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
      const screenW = menuVisible ? width - s(400) : width;

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

  // ── Gesture: swipe para cerrar split ─────────────────────────────────────
  const onSplitStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.END) {
      if (Math.abs(event.nativeEvent.translationX) > 120) {
        exitSplit();
      }
    }
  };

  // ── Feed assignment ──────────────────────────────────────────────────────
  const cameraStatus = getFeedStatus(cameraFeed, 'CAM', mediaConnected, mediaError, Date.now());
  const lidarStatus = lidarData ? `LIDAR ${lidarData.count} pts` : mediaConnected ? 'LIDAR esperando' : 'LIDAR offline';

  const CamView = useCallback(
    () => (
      <LiveFeed
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

  // ── Drag preview ─────────────────────────────────────────────────────────
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

            {/* ── VIDEO AREA ── */}
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

            {/* ── HUD HEADER ── */}
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
                  <Text style={styles.buildingsButtonText}>BUILDINGS</Text>
                </TouchableOpacity>
              </View>
          </View>

            {/* ── CONTROLS ── */}
            <View style={styles.controlsOverlay} pointerEvents="box-none">
              {joystickEnabled ? <JoystickLeft /> : <DPad />}

              {/* ── Bottom tab panel ── */}
              <View style={styles.actionContainer}>
                {/* Tab bar */}
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

                {/* Tab content */}
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

        {/* ── SIDE MENU ── */}
        <Animated.View style={[styles.pushMenu, { width: menuWidth }]}>
          {menuVisible && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: s(16) }} showsVerticalScrollIndicator={false}>
              <TouchableOpacity onPress={() => setMenuVisible(false)} style={styles.menuCloseButton}>
                <Text style={{ color: 'white', fontSize: 22 }}>→</Text>
                <Text style={{ color: 'white', fontWeight: 'bold', marginLeft: 10 }}>MENÚ</Text>
              </TouchableOpacity>
              <View style={{ width: '100%', height: 1, backgroundColor: '#222', marginBottom: 12 }} />

              {/* ── Velocidad ── */}
              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginBottom: 4 }]}>VELOCIDAD</Text>
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

              {/* ── Navegación autónoma ── */}
              <Text style={[styles.telemetryLine, { color: '#f23b3f', marginTop: 14, marginBottom: 4 }]}>NAVEGACIÓN AUTÓNOMA</Text>
              <View style={styles.autoRow}>
                <TouchableOpacity
                  style={[styles.autoBtn, autoMode && { backgroundColor: 'rgba(69,212,131,0.25)' }]}
                  onPress={() => {
                    if (autoMode) return;
                    setAutoMode(true);
                    autonomousStart().catch(() => setAutoMode(false));
                  }}
                >
                  <Text style={styles.autoBtnText}>▶ EXPLORAR</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.autoBtn, styles.autoBtnStop]}
                  onPress={() => { setAutoMode(false); autonomousStop().catch(() => {}); }}
                >
                  <Text style={[styles.autoBtnText, styles.autoBtnTextStop]}>⏹ DETENER</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.autoBtn, styles.autoBtnEmergency, { marginTop: 6 }]}
                onPress={() => { setAutoMode(false); emergencyStop().catch(() => {}); }}
              >
                <Text style={[styles.autoBtnText, styles.autoBtnTextEmergency]}>⛔ PARADA EMERGENCIA</Text>
              </TouchableOpacity>
              {autoMode && <Text style={[styles.autoBtnText, { marginTop: 6 }]}>● autonomía activa</Text>}

              {/* ── Telemetría ── */}
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

              {/* ── Edificios ── */}
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

      {/* ── MODAL CONFIRMAR SALIDA ── */}
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
