import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRobotStatus, loginUser, registerUser, setBackendHost, RobotStatus } from '../services/api';
import { useAppSettings } from '../contexts/AppSettings';
import Icon from '../components/Icons';
import { styles, SETTINGS_PANEL_W } from '../styles/index';
import { C } from '../styles/theme';
import { d } from '../utils/scale';

const BACKEND_IP_KEY = 'laika.backendIp';

// Robot selector entries from the design; only the first one is real for now.
const ROBOT_OPTIONS = [
  { id: 'go2_02', name: 'UNITREE 02' },
  { id: 'go2_01', name: 'UNITREE 01' },
  { id: 'b1', name: 'UNITREE B1' },
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.toggle, value && styles.toggleOn]}>
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </Pressable>
  );
}

function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(1);
  const set = (x: number) => onChange(Math.round(Math.min(100, Math.max(0, (x / width) * 100))));
  return (
    <View
      style={styles.sliderArea}
      onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => set(e.nativeEvent.locationX)}
      onResponderMove={(e) => set(e.nativeEvent.locationX)}
    >
      <View style={styles.sliderTrack} pointerEvents="none">
        <View style={[styles.sliderFill, { width: `${value}%` }]} />
      </View>
      <View style={[styles.sliderThumb, { left: `${value}%` }]} pointerEvents="none" />
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { joystickEnabled, setJoystickEnabled, volume, setVolume, loggedUser, setLoggedUser } = useAppSettings();

  const [robot, setRobot] = useState<RobotStatus | null>(null);
  const [robotReachable, setRobotReachable] = useState<boolean | null>(null);
  const [robotMenuOpen, setRobotMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const panelX = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    // A backend IP saved by older versions still applies (no UI for it now).
    AsyncStorage.getItem(BACKEND_IP_KEY).then((saved) => { if (saved) setBackendHost(saved); }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = () => getRobotStatus()
      .then((s) => { if (alive) { setRobot(s); setRobotReachable(true); } })
      .catch(() => { if (alive) setRobotReachable(false); });
    poll();
    const interval = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    Animated.timing(panelX, { toValue: settingsOpen ? 0 : 1, duration: 220, useNativeDriver: false }).start();
  }, [panelX, settingsOpen]);

  const robotLine = robotReachable === null
    ? 'Buscando…'
    : robotReachable
      ? `Conectado | ${robot?.battery != null ? `${Math.round(robot.battery)}%` : '—'}`
      : 'Sin conexión';

  const login = () => {
    loginUser(email, password)
      .then(() => { setLoggedUser(email.split('@')[0]); setAuthVisible(false); })
      .catch((e: Error) => Alert.alert('Login', e.message));
  };
  const register = () => {
    registerUser(email, password)
      .then(() => { setAuthVisible(false); Alert.alert('Registro', 'Usuario creado'); })
      .catch((e: Error) => Alert.alert('Registro', e.message));
  };

  return (
    <View style={styles.window}>
      {Platform.OS === 'web' && React.createElement('div', { style: BACKGROUND_WEB })}

      {/* Robot selector (page 14): opens/closes, no switching yet. */}
      <View style={styles.robotArea}>
        <TouchableOpacity activeOpacity={0.85} style={styles.robotPill} onPress={() => setRobotMenuOpen((v) => !v)}>
          <View>
            <Text style={styles.robotName}>UNITREE 02</Text>
            <Text style={styles.robotSub}>{robotLine}</Text>
          </View>
          <Icon name={robotMenuOpen ? 'chevronUp' : 'chevronDown'} size={d(16)} strokeWidth={3} />
        </TouchableOpacity>
        {robotMenuOpen && (
          <View style={styles.robotMenu}>
            {ROBOT_OPTIONS.map((option, i) => (
              <TouchableOpacity
                key={option.id}
                activeOpacity={0.8}
                style={[styles.robotOption, i === 0 && styles.robotOptionSelected]}
                onPress={() => setRobotMenuOpen(false)}
              >
                <View>
                  <Text style={styles.robotName}>{option.name}</Text>
                  {/* Only UNITREE 02 is wired up; the rest are design placeholders. */}
                  <Text style={styles.robotSub}>{i === 0 ? robotLine : 'Próximamente'}</Text>
                </View>
                {i === 0 && <Icon name="check" size={d(16)} color={C.red} strokeWidth={3} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity activeOpacity={0.8} style={styles.robotAdd} onPress={() => setRobotMenuOpen(false)}>
              <Icon name="plus" size={d(16)} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.topRight}>
        <TouchableOpacity activeOpacity={0.85} style={styles.iconButton} onPress={() => setAuthVisible(true)}>
          <Icon name="user" size={d(24)} strokeWidth={1.9} />
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.85} style={styles.iconButton} onPress={() => setSettingsOpen(true)}>
          <Icon name="gear" size={d(26)} strokeWidth={1.9} />
        </TouchableOpacity>
      </View>

      <View style={styles.mainColumn}>
        <View style={styles.logoBlock}>
          <Text style={styles.logoText}>
            L<Text style={styles.logoAccent}>AI</Text>KA
          </Text>
          <Text style={styles.logoSub}>rescue dog</Text>
        </View>
        <TouchableOpacity activeOpacity={0.85} style={styles.primaryButton} onPress={() => router.push('/preparar')}>
          <Icon name="play" size={d(17)} />
          <Text style={styles.primaryButtonText}>INICIAR MISIÓN</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.85} style={styles.secondaryButton} onPress={() => router.push('/data')}>
          <Icon name="folder" size={d(23)} strokeWidth={2.1} />
          <Text style={styles.primaryButtonText}>MISIONES Y DATOS</Text>
        </TouchableOpacity>
      </View>

      {/* Settings side panel (page 15). */}
      {settingsOpen && <Pressable style={styles.dim} onPress={() => setSettingsOpen(false)} />}
      <Animated.View
        pointerEvents={settingsOpen ? 'auto' : 'none'}
        style={[styles.settingsPanel, {
          transform: [{ translateX: panelX.interpolate({ inputRange: [0, 1], outputRange: [0, SETTINGS_PANEL_W + 20] }) }],
        }]}
      >
        <View style={styles.settingsHeader}>
          <Text style={styles.settingsTitle}>Ajustes</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.closeButton} onPress={() => setSettingsOpen(false)}>
            <Icon name="close" size={d(22)} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Volumen</Text>
          <Slider value={volume} onChange={setVolume} />
        </View>
        <View style={[styles.settingsCard, styles.settingsRow]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Joystick</Text>
            <Text style={styles.cardText}>
              Estando esta función activada el perro se podrá desplazar a partir de joysticks. Sino será con flechas indicadoras.
            </Text>
          </View>
          <Toggle value={joystickEnabled} onChange={setJoystickEnabled} />
        </View>
      </Animated.View>

      <Modal animationType="fade" transparent visible={authVisible} onRequestClose={() => setAuthVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setAuthVisible(false)}>
          <Pressable style={styles.modalCard}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>{loggedUser ? 'Cuenta' : 'Iniciar sesión'}</Text>
              <TouchableOpacity activeOpacity={0.85} style={styles.closeButton} onPress={() => setAuthVisible(false)}>
                <Icon name="close" size={d(22)} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
            {loggedUser ? (
              <>
                <Text style={styles.cardTitle}>{loggedUser}</Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.secondaryButton, styles.modalButton]}
                  onPress={() => { setLoggedUser(null); setAuthVisible(false); }}
                >
                  <Text style={styles.modalButtonText}>Cerrar sesión</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>EMAIL</Text>
                <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} placeholderTextColor={C.textFaint} />
                <Text style={styles.fieldLabel}>CONTRASEÑA</Text>
                <TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholderTextColor={C.textFaint} />
                <View style={styles.modalActions}>
                  <TouchableOpacity activeOpacity={0.85} style={[styles.secondaryButton, styles.modalButton]} onPress={register}>
                    <Text style={styles.modalButtonText}>Registrarme</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.85} style={[styles.primaryButton, styles.modalButton]} onPress={login}>
                    <Text style={styles.modalButtonText}>Ingresar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// Warm light from the top right fading into the dark base (page 1).
const BACKGROUND_WEB = {
  position: 'absolute',
  inset: 0,
  background: `radial-gradient(120% 85% at 85% -10%, ${C.bgTop} 0%, #3a3131 38%, rgba(40,34,34,0) 70%), linear-gradient(180deg, #332b2b 0%, ${C.bg} 55%)`,
  pointerEvents: 'none',
} as const;
