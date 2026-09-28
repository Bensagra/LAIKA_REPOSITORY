import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { crearMision, DOG_API_URL, registerUser, loginUser, setBackendHost, getBackendHost } from '../services/api';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import 'react-native-gesture-handler';

import { styles } from '../styles/index';
import { useAppSettings } from '../contexts/AppSettings';
import { s } from '../utils/scale';
import { startServerMission } from '../services/missions';

const BACKEND_IP_KEY = 'laika.backendIp';

export default function HomeScreen() {
  const router = useRouter();
  const {
    joystickEnabled, setJoystickEnabled, loggedUser, setLoggedUser, setMisionActiva,
    videoResolution, setVideoResolution, lidarMaxPoints, setLidarMaxPoints,
  } = useAppSettings();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authVisible, setAuthVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [pillMenuOpen, setPillMenuOpen] = useState(false);
  const [backendIp, setBackendIpState] = useState(getBackendHost());

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    AsyncStorage.getItem(BACKEND_IP_KEY).then((saved) => {
      if (saved) { setBackendHost(saved); setBackendIpState(saved); }
    }).catch(() => {});
  }, []);

  const saveBackendIp = (ip: string) => {
    const clean = ip.trim();
    if (!clean) return;
    setBackendHost(clean);
    setBackendIpState(clean);
    AsyncStorage.setItem(BACKEND_IP_KEY, clean).catch(() => {});
  };

  const register = () => {
    registerUser(email, password)
      .then(() => { setAuthVisible(false); Alert.alert('Registro', 'Usuario creado'); })
      .catch((e: Error) => Alert.alert('Registro', e.message));
  };

  const login = () => {
    loginUser(email, password)
      .then(() => { setLoggedUser(email.split('@')[0]); setAuthVisible(false); })
      .catch((e: Error) => Alert.alert('Login', e.message));
  };

  return (
    <View style={styles.window}>
      <View style={styles.topBar}>
        <TouchableOpacity activeOpacity={0.8} style={styles.statusPill} onPress={() => setPillMenuOpen((v) => !v)}>
          <Text style={styles.statusText}>UNITREE 02 | BATT 85%</Text>
          <MaterialIcons name="arrow-drop-down" size={s(22)} color="#E83D3D" />
        </TouchableOpacity>

        {pillMenuOpen && (
          <View style={styles.pillMenu}>
            <TouchableOpacity style={styles.pillMenuItem} onPress={() => { setPillMenuOpen(false); setAuthVisible(true); }}>
              <Text style={styles.pillMenuText}>{loggedUser ? `CUENTA: ${loggedUser}` : 'LOGIN'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillMenuItem} onPress={() => { setPillMenuOpen(false); setSettingsVisible(true); }}>
              <Text style={styles.pillMenuText}>AJUSTES</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.container}>
        <Text style={styles.logoText}>
          L<Text style={styles.logoAccent}>AI</Text>KA
        </Text>
        <View style={styles.buttonWrapper}>
          <TouchableOpacity activeOpacity={0.75} style={styles.mainButton} onPress={() => router.push('/data')}>
            <Text style={styles.buttonText}>DATA</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.mainButton}
            onPress={async () => {
              const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
              const nombre = `Misión ${fecha}`;
              // Backend (:3000) mission and robot-server recording start together.
              const [local, server] = await Promise.allSettled([crearMision(nombre), startServerMission(nombre)]);
              const serverMissionId = server.status === 'fulfilled' ? server.value.mission_id : null;
              if (local.status === 'fulfilled') {
                setMisionActiva({ id: local.value.id_mision, nombre: local.value.nombre, serverMissionId });
              } else {
                setMisionActiva({ id: 0, nombre: 'Misión local', serverMissionId });
              }
              if (server.status === 'rejected') {
                Alert.alert('Grabación', `No se pudo iniciar la grabación en el servidor: ${server.reason instanceof Error ? server.reason.message : String(server.reason)}`);
              }
              router.push('/mision');
            }}
          >
            <Text style={styles.buttonText}>START</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal animationType="fade" transparent visible={settingsVisible} onRequestClose={() => setSettingsVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSettingsVisible(false)}>
          <Pressable style={styles.authModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>AJUSTES</Text>
              <TouchableOpacity activeOpacity={0.8} style={styles.modalClose} onPress={() => setSettingsVisible(false)}>
                <MaterialIcons name="close" size={s(18)} color="#f23b3f" />
              </TouchableOpacity>
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>JOYSTICK</Text>
              <Switch
                value={joystickEnabled}
                onValueChange={setJoystickEnabled}
                trackColor={{ false: '#333', true: 'rgba(242, 59, 63, 0.35)' }}
                thumbColor={joystickEnabled ? '#f23b3f' : '#666'}
              />
            </View>
            <View style={styles.mediaSetting}>
              <Text style={styles.settingLabel}>RESOLUCIÓN DE VIDEO</Text>
              <View style={styles.settingOptions}>
                {[640, 960, 1280].map((value) => (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setVideoResolution(value)}
                    style={[styles.settingOption, videoResolution === value && styles.settingOptionActive]}
                  >
                    <Text style={[styles.settingOptionText, videoResolution === value && styles.settingOptionTextActive]}>{value}p</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.settingHint}>Menor resolución = video más fluido.</Text>
            </View>
            <View style={styles.mediaSetting}>
              <Text style={styles.settingLabel}>RESOLUCIÓN LIDAR</Text>
              <View style={styles.settingOptions}>
                {[
                  { value: 2500, label: 'BAJA' },
                  { value: 8000, label: 'MEDIA' },
                  { value: 30000, label: 'ALTA' },
                ].map(({ value, label }) => (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setLidarMaxPoints(value)}
                    style={[styles.settingOption, lidarMaxPoints === value && styles.settingOptionActive]}
                  >
                    <Text style={[styles.settingOptionText, lidarMaxPoints === value && styles.settingOptionTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.settingHint}>{lidarMaxPoints.toLocaleString()} puntos por cuadro · baja es la más fluida.</Text>
            </View>
            <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}>
              <Text style={styles.settingLabel}>IP LAPTOP (backend)</Text>
              <TextInput
                value={backendIp}
                onChangeText={setBackendIpState}
                onEndEditing={(e) => saveBackendIp(e.nativeEvent.text)}
                onSubmitEditing={(e) => saveBackendIp(e.nativeEvent.text)}
                placeholder="10.40.5.11"
                placeholderTextColor="#555"
                autoCapitalize="none"
                keyboardType="decimal-pad"
                style={[styles.input, { width: '100%', marginBottom: 0 }]}
              />
              <Text style={{ color: '#555', fontFamily: 'monospace', fontSize: s(10) }}>
                Puerto 3000 (backend) y 3001 (IA) se agregan solos
              </Text>
              <Text style={{ color: '#555', fontFamily: 'monospace', fontSize: s(10) }}>
                API robot fija: {DOG_API_URL}
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={authVisible} onRequestClose={() => setAuthVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setAuthVisible(false)}>
          <Pressable style={styles.authModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{loggedUser ? 'CUENTA' : 'ACCESO'}</Text>
              <TouchableOpacity activeOpacity={0.8} style={styles.modalClose} onPress={() => setAuthVisible(false)}>
                <MaterialIcons name="close" size={s(18)} color="#f23b3f" />
              </TouchableOpacity>
            </View>
            {loggedUser ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <MaterialIcons name="person" size={s(22)} color="#f23b3f" />
                  <Text style={[styles.authActionText, { fontSize: 18 }]}>{loggedUser}</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[styles.authAction, { backgroundColor: 'transparent', borderColor: '#f23b3f' }]}
                  onPress={() => { setLoggedUser(null); setAuthVisible(false); }}
                >
                  <Text style={styles.authActionText}>CERRAR SESIÓN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="EMAIL" placeholderTextColor="#8b7474" style={styles.input} />
                <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="PASSWORD" placeholderTextColor="#8b7474" style={styles.input} />
                <View style={styles.modalActions}>
                  <TouchableOpacity activeOpacity={0.75} style={styles.authAction} onPress={register}>
                    <Text style={styles.authActionText}>REGISTRO</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.75} style={styles.authAction} onPress={login}>
                    <Text style={styles.authActionText}>LOGIN</Text>
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
