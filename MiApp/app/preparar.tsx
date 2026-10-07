import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getRobotStatus } from '../services/api';
import { listServerMissions, startServerMission } from '../services/missions';
import { connectRobotWS } from '../services/robotSocket';
import { useAppSettings } from '../contexts/AppSettings';
import { hasMicAndSpeaker, readDeviceBattery } from '../utils/device';
import Icon from '../components/Icons';
import Svg, { Path } from 'react-native-svg';
import { C, HELV, VIGA } from '../styles/theme';
import { d } from '../utils/scale';

// "Preparar misión" (PDF pages 13 → 2): mission data on the left, live
// pre-flight checks on the right. Failures don't block starting the mission.

type CheckKey = 'robot' | 'robotBattery' | 'phoneBattery' | 'cameras' | 'audio';
type CheckState = { status: 'pending' | 'ok' | 'fail' | 'na'; value: string };

const CHECK_LABELS: Record<CheckKey, string> = {
  robot: 'Conexión con el robot',
  robotBattery: 'Batería del robot',
  phoneBattery: 'Batería del celular',
  cameras: 'Cámaras',
  audio: 'Micrófono y parlante',
};
const CHECK_ORDER: CheckKey[] = ['robot', 'robotBattery', 'phoneBattery', 'cameras', 'audio'];

// Streams the robot can send; the night camera has no source yet (4 views total).
const CAMERA_WINDOW_MS = 6000;
const MIN_SPIN_MS = 700;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Spinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg width={d(22)} height={d(22)} viewBox="0 0 24 24">
        <Path d="M19 6.5A9 9 0 1 0 19 17.5" stroke={C.textSoft} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

function StatusIcon({ status }: { status: CheckState['status'] }) {
  if (status === 'pending') return <Spinner />;
  const bg = status === 'ok' ? C.green : status === 'fail' ? C.red : C.muted;
  return (
    <View style={[styles.statusDot, { backgroundColor: bg }]}>
      <Icon name={status === 'ok' ? 'check' : status === 'fail' ? 'close' : 'minus'} size={d(13)} color="#1f1a1a" strokeWidth={3.2} />
    </View>
  );
}

export default function PrepararScreen() {
  const router = useRouter();
  const { loggedUser, setMisionActiva } = useAppSettings();
  const [nombre, setNombre] = useState('');
  const [operador, setOperador] = useState(loggedUser ?? '');
  const [ubicacion, setUbicacion] = useState('');
  const [checks, setChecks] = useState<Record<CheckKey, CheckState>>(() =>
    Object.fromEntries(CHECK_ORDER.map((k) => [k, { status: 'pending', value: '...' }])) as Record<CheckKey, CheckState>);
  const [starting, setStarting] = useState(false);
  const nameTouched = useRef(false);

  const setCheck = (key: CheckKey, state: CheckState) => setChecks((prev) => ({ ...prev, [key]: state }));

  // Suggested name: next mission number.
  useEffect(() => {
    listServerMissions().then((list) => {
      if (!nameTouched.current) setNombre(`Misión ${String(list.length + 1).padStart(2, '0')}`);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const started = Date.now();
    const settle = async (key: CheckKey, state: CheckState) => {
      await wait(Math.max(0, MIN_SPIN_MS - (Date.now() - started)));
      if (alive) setCheck(key, state);
    };

    getRobotStatus()
      .then((s) => {
        settle('robot', { status: 'ok', value: 'OK' });
        settle('robotBattery', s.battery == null
          ? { status: 'na', value: '—' }
          : { status: s.battery >= 35 ? 'ok' : 'fail', value: `${Math.round(s.battery)}%` });
      })
      .catch(() => {
        settle('robot', { status: 'fail', value: 'SIN SEÑAL' });
        settle('robotBattery', { status: 'fail', value: '—' });
      });

    readDeviceBattery().then((level) => settle('phoneBattery', level == null
      ? { status: 'na', value: '—' }
      : { status: level >= 35 ? 'ok' : 'fail', value: `${level}%` }));

    hasMicAndSpeaker().then((ok) => settle('audio', ok == null
      ? { status: 'na', value: '—' }
      : { status: ok ? 'ok' : 'fail', value: ok ? 'OK' : 'FALTA' }));

    // Cameras: listen to the live feed briefly and count streams that send data.
    const seen = new Set<string>();
    let finished = false;
    const finishCameras = () => {
      if (finished) return;
      finished = true;
      settle('cameras', { status: seen.has('camera') ? 'ok' : 'fail', value: `${seen.size}/4` });
    };
    const mark = (stream: string) => {
      seen.add(stream);
      if (seen.size >= 4) finishCameras(); // camera + thermal + LiDAR + Arducam (nocturna)
    };
    const disconnect = connectRobotWS({
      onVideoFrame: () => mark('camera'),
      onVideoTick: () => mark('camera'),
      onThermal: () => mark('thermal'),
      onArducam: () => mark('arducam'),
      onLidar: () => mark('lidar'),
    });
    const timer = setTimeout(finishCameras, CAMERA_WINDOW_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
      disconnect();
    };
  }, []);

  const verifying = CHECK_ORDER.some((k) => checks[k].status === 'pending');

  const start = async () => {
    if (verifying || starting) return;
    setStarting(true);
    const name = nombre.trim() || 'Misión';
    const server = await startServerMission(name).catch(() => null);
    if (!server) {
      Alert.alert('Misión', 'No se pudo iniciar la grabación en el servidor: la misión va a continuar sin quedar guardada.');
    }
    setMisionActiva({
      nombre: server?.name ?? name,
      operador: operador.trim(),
      ubicacion: ubicacion.trim(),
      startedAt: Date.now(),
      serverMissionId: server?.mission_id ?? null,
    });
    router.replace('/mision');
  };

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.85} style={styles.backButton} onPress={() => router.replace('/')}>
          <Icon name="arrowLeft" size={d(24)} strokeWidth={2.6} />
        </TouchableOpacity>
        <Text style={styles.title}>Preparar misión</Text>
      </View>

      <View style={styles.columns}>
        <ScrollView style={styles.card} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>NOMBRE</Text>
          <TextInput
            value={nombre}
            onChangeText={(v) => { nameTouched.current = true; setNombre(v); }}
            style={styles.input}
            placeholder="Misión"
            placeholderTextColor={C.textFaint}
          />
          <Text style={styles.label}>OPERADOR</Text>
          <TextInput value={operador} onChangeText={setOperador} style={styles.input} placeholder="Bombero J. Perez" placeholderTextColor={C.textFaint} />
          <Text style={styles.label}>UBICACIÓN</Text>
          <TextInput value={ubicacion} onChangeText={setUbicacion} style={styles.input} placeholder="Av. Libertador 1234, CABA" placeholderTextColor={C.textFaint} />
        </ScrollView>

        <View style={[styles.card, styles.checksCard]}>
          {CHECK_ORDER.map((key, i) => (
            <View key={key} style={[styles.checkRow, i < CHECK_ORDER.length - 1 && styles.checkDivider]}>
              <Text style={styles.checkLabel}>{CHECK_LABELS[key]}</Text>
              <View style={styles.checkRight}>
                <Text style={styles.checkValue}>{checks[key].value}</Text>
                <StatusIcon status={checks[key].status} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={verifying || starting}
        onPress={start}
        style={[styles.startButton, verifying && styles.startButtonBusy]}
      >
        <Text style={[styles.startText, verifying && styles.startTextBusy]}>
          {verifying ? 'VERIFICANDO...' : starting ? 'INICIANDO...' : 'COMENZAR MISIÓN'}
        </Text>
        {!verifying && !starting && <Icon name="arrowRight" size={d(22)} strokeWidth={2.6} />}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: C.bg, paddingHorizontal: d(41), paddingTop: d(17), paddingBottom: d(15) },
  header: { flexDirection: 'row', alignItems: 'center', gap: d(15), marginLeft: d(-11), marginBottom: d(8) },
  backButton: {
    width: d(49),
    height: d(49),
    borderRadius: d(13),
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.text, fontFamily: VIGA, fontSize: d(22) },

  columns: { flex: 1, flexDirection: 'row', gap: d(34) },
  card: { flex: 1, backgroundColor: C.card, borderRadius: d(19) },
  formContent: { paddingHorizontal: d(15), paddingTop: d(14), paddingBottom: d(14) },
  label: { color: C.textSoft, fontFamily: HELV, fontWeight: '700', fontSize: d(10.5), marginLeft: d(5), marginBottom: d(6), marginTop: d(4) },
  input: {
    height: d(37),
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: d(13),
    paddingHorizontal: d(17),
    color: C.text,
    fontFamily: HELV,
    fontWeight: '700',
    fontSize: d(13),
    marginBottom: d(10),
  },

  checksCard: { paddingHorizontal: d(17), paddingVertical: d(6), justifyContent: 'space-between' },
  checkRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: d(7) },
  checkDivider: { borderBottomWidth: 1.5, borderBottomColor: C.divider },
  checkLabel: { color: C.textSoft, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },
  checkRight: { flexDirection: 'row', alignItems: 'center', gap: d(12) },
  checkValue: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },
  statusDot: { width: d(21), height: d(21), borderRadius: d(10.5), alignItems: 'center', justifyContent: 'center' },

  startButton: {
    height: d(48),
    marginTop: d(13),
    borderRadius: d(16),
    backgroundColor: C.red,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: d(14),
  },
  startButtonBusy: { backgroundColor: C.muted },
  startText: { color: C.text, fontFamily: VIGA, fontSize: d(20), letterSpacing: 0.5 },
  startTextBusy: { color: C.textFaint },
});
