import React, { useRef, useState, useEffect } from 'react';
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
} from 'react-native';
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
import { styles, PIP_W } from '../styles/misionStyles';
import { useAppSettings } from '../contexts/AppSettings';
import { moveRobot, getRobotStatus, RobotStatus, analyzeBuilding, AnalysisResult, DañoDetectado, finalizarMision } from '../services/api';
const { width } = Dimensions.get('window');

interface Edificio {
  nombre: string;
  previewUri: string;
  analysis: AnalysisResult;
}

// ─── D-Pad component ──────────────────────────────────────────────────────────
const DPad = () => (
  <View style={styles.dpadArea}>
    <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('forward')}>
      <MaterialIcons name="keyboard-arrow-up" size={30} color="#161616" />
    </TouchableOpacity>
    <View style={styles.dpadMiddleRow}>
      <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('left')}>
        <MaterialIcons name="keyboard-arrow-left" size={30} color="#161616" />
      </TouchableOpacity>
      <View style={styles.dpadCenter} />
      <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('right')}>
        <MaterialIcons name="keyboard-arrow-right" size={30} color="#161616" />
      </TouchableOpacity>
    </View>
    <TouchableOpacity style={styles.dpadBtn} onPress={() => moveRobot('backward')}>
      <MaterialIcons name="keyboard-arrow-down" size={30} color="#161616" />
    </TouchableOpacity>
  </View>
);

// ─── Placeholder views ────────────────────────────────────────────────────────
const CamView = () => (
  <View style={styles.videoStreamContainer}>
    <Text style={styles.videoPlaceholderText}>[ CAMARA GO2 ]</Text>
  </View>
);

const LidarView = () => (
  <View style={[styles.videoStreamContainer, styles.lidarStreamContainer]}>
    <Text style={styles.lidarPlaceholderText}>[ LiDAR SCANNER ]</Text>
  </View>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MisionScreen() {
  const router = useRouter();
  const { joystickEnabled, misionActiva, setMisionActiva } = useAppSettings();
  const [isExtraFeature, setIsExtraFeature] = useState(false);
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);
  const [stopHovered, setStopHovered] = useState(false);
  const sliderAnim = useRef(new Animated.Value(0)).current;

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
    Animated.timing(menuAnim, {
      toValue: menuVisible ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [menuAnim, menuVisible]);

  const menuWidth = menuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 400], //agrandar el panel
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
        const screenW = menuVisible ? width - 220 : width;
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
      const screenW = menuVisible ? width - 220 : width;

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

  const pickFile = () => {
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

  const blobToBase64 = async (url: string): Promise<string> => {
    try {
      const blob = await fetch(url).then(r => r.blob());
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  };

  const bottomActions = ['MENU', 'WALKIE', 'FOTO/VIDEO', 'LINTERNA'];

  const handleBottomAction = (action: string) => {
    if (action === 'MENU') {
      setMenuVisible(true);
      return;
    }

    if (action === 'LINTERNA') {
      setIsExtraFeature((current) => !current);
      return;
    }

    console.log(action);
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
  const onSliderGesture = Animated.event(
    [{ nativeEvent: { translationX: sliderAnim } }],
    { useNativeDriver: false }
  );
  
  const onSliderStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      Animated.spring(sliderAnim, { toValue: 0, useNativeDriver: false }).start();
    }
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
                    size={16}
                    color="#f23b3f"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.rightHudGroup}>
                <TouchableOpacity style={styles.aiHudButton} onPress={() => setAiVisible(true)}>
                  <MaterialIcons name="auto-awesome" size={18} color="#f23b3f" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMenuVisible(!menuVisible)} style={styles.buildingsButton}>
                  <Text style={styles.buildingsButtonText}>BUILDINGS</Text>
                </TouchableOpacity>
              </View>
          </View>

          <View
            style={[styles.sliderWrapper, isSplit && styles.sliderWrapperSplit]}
            {...({
              onMouseEnter: () => setStopHovered(true),
              onMouseLeave: () => setStopHovered(false),
            } as any)}
          >
            <PanGestureHandler
              onGestureEvent={onSliderGesture}
              onHandlerStateChange={onSliderStateChange}
            >
              <Animated.View
                style={[
                  styles.sliderBar,
                  stopHovered && styles.sliderBarActive,
                  { width: sliderAnim.interpolate({
                      inputRange: [0, PIP_W - 80],
                      outputRange: [80, PIP_W],
                      extrapolate: 'clamp'
                    })
                  },
                ]}
              >
                <Text style={[styles.sliderText, stopHovered && styles.sliderTextActive]}>STOP</Text>
              </Animated.View>
            </PanGestureHandler>
          </View>


            {/* ── CONTROLS ── */}
            <View style={styles.controlsOverlay} pointerEvents="box-none">
              {joystickEnabled ? (
                <View style={styles.joystickArea}>
                  <View style={styles.joystickBase}><View style={styles.joystickStick} /></View>
                </View>
              ) : (
                <DPad />
              )}

              <View style={styles.actionContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionScroll} contentContainerStyle={styles.actionScrollContent}>
                  {bottomActions.map((action, i) => (
                    <TouchableOpacity key={action} style={styles.actionButton} onPress={() => handleBottomAction(action)}>
                      {i > 0 && <Text style={styles.actionSeparator}>|</Text>}
                      <Text style={styles.actionButtonText}>{action}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {joystickEnabled ? (
                <View style={styles.joystickArea}>
                  <View style={styles.joystickBase}><View style={styles.joystickStick} /></View>
                </View>
              ) : (
                <DPad />
              )}
            </View>

          </View>
        </View>

        {/* ── SIDE MENU ── */}
        <Animated.View style={[styles.pushMenu, { width: menuWidth }]}>
          {menuVisible && (
            <View style={styles.menuInnerContent}>
              <TouchableOpacity onPress={() => setMenuVisible(false)} style={styles.menuCloseButton}>
                <Text style={{ color: 'white', fontSize: 22 }}>→</Text>
                <Text style={{ color: 'white', fontWeight: 'bold', marginLeft: 10 }}>EDIFICIOS</Text>
              </TouchableOpacity>
              <View style={{ width: '100%', height: 1, backgroundColor: '#222', marginBottom: 16 }} />

              {edificios.length === 0 ? (
                <Text style={{ color: '#433838', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
                  Sin edificios analizados
                </Text>
              ) : (
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  {[...edificios].reverse().map((e) => (
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
                  ))}
                </ScrollView>
              )}
            </View>
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
                          previewUri: await blobToBase64(e.previewUri),
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
                  <MaterialIcons name="close" size={18} color="#f23b3f" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity activeOpacity={0.8} style={styles.uploadArea} onPress={pickFile}>
                {previewUri ? (
                  <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
                ) : (
                  <>
                    <MaterialIcons name="cloud-upload" size={36} color="#6a4a4b" />
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
