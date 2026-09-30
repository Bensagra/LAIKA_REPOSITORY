import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getServerMission,
  listServerMissions,
  loadMissionMap,
  MISSION_STATUS_LABELS,
  missionFileUrl,
  missionIsReady,
  MissionPlayback,
  openMissionPlayback,
  requestMissionDownload,
  ServerMission,
  formatMissionTime,
} from '../services/missions';
import LidarReconstruction, { LidarSink } from '../components/LidarReconstruction';
import Icon from '../components/Icons';
import { C, HELV, VIGA } from '../styles/theme';
import { d } from '../utils/scale';

// "Misiones" library, backed by the server's own recordings (camera.mp4,
// thermal.mp4, LiDAR map) per "Misiones: instalación, API e integración con
// otro frontend" — not the old local/Node gallery. Renombrar/borrar quedan
// afuera a propósito: esa API no los ofrece hoy.

function formatFecha(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function statusColor(status: ServerMission['status']) {
  if (status === 'completed') return C.green;
  if (status === 'recording' || status === 'finalizing') return C.yellow;
  return C.red; // error, interrupted
}

const videoStyle = {
  width: '100%',
  aspectRatio: '16 / 9',
  background: '#000',
  borderRadius: 12,
  display: 'block',
} as const;

// ── Player (expanded mission) ───────────────────────────────────────────────

function MissionPlayer({ missionId, ready, statusNote, missingStreams }: {
  missionId: string;
  ready: boolean;
  statusNote: string | null;
  missingStreams?: string[];
}) {
  const [playback, setPlayback] = useState<MissionPlayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPoints, setMapPoints] = useState<Float32Array | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const thermalRef = useRef<HTMLVideoElement | null>(null);
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const sinkRef = useRef<LidarSink | null>(null);

  const openPlayback = useCallback(async (renew: boolean) => {
    const generation = ++generationRef.current;
    if (renewalTimerRef.current) { clearTimeout(renewalTimerRef.current); renewalTimerRef.current = null; }
    try {
      const result = await openMissionPlayback(missionId);
      if (generation !== generationRef.current) return;
      setPlayback(result);
      setError(null);
      (['camera', 'thermal'] as const).forEach((stream) => {
        const video = stream === 'camera' ? cameraRef.current : thermalRef.current;
        if (!video) return;
        const track = result.videos[stream];
        const position = renew ? video.currentTime : 0;
        const resume = renew && !video.paused;
        video.pause();
        video.onloadedmetadata = null;
        if (!track) { video.removeAttribute('src'); video.load(); return; }
        video.onloadedmetadata = () => {
          video.currentTime = Math.min(position, Math.max(0, video.duration - 0.001));
          if (resume) video.play().catch(() => {});
        };
        video.src = missionFileUrl(track.path);
        video.load();
      });
      renewalTimerRef.current = setTimeout(() => {
        openPlayback(true).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo renovar la reproducción'));
      }, Math.max(30, result.expires_in_s - 60) * 1000);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setPlayback(null);
      setError(err instanceof Error ? err.message : 'No se pudo abrir la reproducción');
    }
  }, [missionId]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !ready) return undefined;
    openPlayback(false);
    return () => {
      generationRef.current++;
      if (renewalTimerRef.current) clearTimeout(renewalTimerRef.current);
      for (const ref of [cameraRef, thermalRef]) {
        const video = ref.current;
        if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      }
    };
  }, [ready, openPlayback]);

  useEffect(() => {
    if (mapOpen && mapPoints) sinkRef.current?.addFrame({ points: mapPoints, colors: null, mode: 'keyframe' });
  }, [mapOpen, mapPoints]);

  const openMap = async () => {
    if (!playback?.map_path) return;
    setMapOpen(true);
    if (mapPoints) return;
    setMapLoading(true);
    setMapError(null);
    try {
      setMapPoints(await loadMissionMap(playback.map_path));
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'No se pudo cargar el mapa');
    } finally {
      setMapLoading(false);
    }
  };

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await requestMissionDownload(missionId, 'mission.zip');
      const link = document.createElement('a');
      link.href = url;
      link.download = `${missionId}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar la descarga');
    } finally {
      setDownloading(false);
    }
  };

  if (!ready) {
    return <View style={styles.detail}><Text style={styles.emptySmall}>{statusNote}</Text></View>;
  }
  if (Platform.OS !== 'web') {
    return <View style={styles.detail}><Text style={styles.emptySmall}>Reproducción disponible en la web</Text></View>;
  }

  return (
    <View style={styles.detail}>
      {!!statusNote && <Text style={[styles.emptySmall, { color: C.yellow }]}>{statusNote}</Text>}
      {!!error && <Text style={[styles.emptySmall, { color: C.red }]}>{error}</Text>}
      {!!missingStreams?.length && (
        <Text style={styles.emptySmall}>Sin datos de: {missingStreams.join(', ')}</Text>
      )}
      <View style={styles.videosRow}>
        <View style={styles.videoCol}>
          <Text style={styles.detailHeading}>Cámara</Text>
          {React.createElement('video', { ref: cameraRef, controls: true, playsInline: true, preload: 'metadata', style: videoStyle })}
        </View>
        <View style={styles.videoCol}>
          <Text style={styles.detailHeading}>Térmica</Text>
          {React.createElement('video', { ref: thermalRef, controls: true, playsInline: true, preload: 'metadata', style: videoStyle })}
        </View>
      </View>
      <View style={styles.playerActions}>
        {!!playback?.map_path && (
          <TouchableOpacity activeOpacity={0.85} style={styles.playerButton} onPress={openMap}>
            <Text style={styles.playerButtonText}>Ver mapa</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity activeOpacity={0.85} disabled={downloading} style={[styles.playerButton, downloading && styles.disabled]} onPress={download}>
          <Text style={styles.playerButtonText}>{downloading ? 'Preparando…' : 'Descargar todo (.zip)'}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={mapOpen} animationType="fade" onRequestClose={() => setMapOpen(false)}>
        <View style={styles.mapModal}>
          <TouchableOpacity activeOpacity={0.85} style={styles.mapClose} onPress={() => setMapOpen(false)}>
            <Icon name="close" size={d(22)} color={C.text} strokeWidth={2.6} />
          </TouchableOpacity>
          {mapLoading && <ActivityIndicator color={C.red} style={{ marginTop: d(60) }} />}
          {!!mapError && <Text style={[styles.empty, { color: C.red }]}>{mapError}</Text>}
          {!mapLoading && !mapError && <LidarReconstruction sinkRef={sinkRef} />}
        </View>
      </Modal>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function DataScreen() {
  const router = useRouter();
  const [missions, setMissions] = useState<ServerMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const list = await listServerMissions();
      if (mounted.current) setMissions(list);
    } catch {
      if (mounted.current) setMissions([]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // "El evento mission no sustituye consultar la API: refrescar cada 3s
  // mientras haya una misión activa" (grabando/finalizando).
  useEffect(() => {
    const hasActive = missions.some((m) => m.status === 'recording' || m.status === 'finalizing');
    if (!hasActive) return undefined;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [missions, load]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    // The list can be a few seconds stale; confirm status before opening the player.
    try {
      const fresh = await getServerMission(id);
      setMissions((prev) => prev.map((m) => (m.mission_id === id ? fresh : m)));
    } catch {
      // Keep whatever the list already had; MissionPlayer will surface its own error.
    }
  };

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.85} style={styles.backButton} onPress={() => router.replace('/')}>
          <Icon name="arrowLeft" size={d(24)} strokeWidth={2.6} />
        </TouchableOpacity>
        <Text style={styles.title}>Misiones</Text>
        <Text style={styles.count}>{missions.length} registrada{missions.length === 1 ? '' : 's'}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={C.red} style={{ marginTop: d(60) }} />
      ) : missions.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay misiones registradas</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {missions.map((m) => {
            const isExpanded = expandedId === m.mission_id;
            const ready = missionIsReady(m);
            const statusNote = m.status === 'recording'
              ? 'Todavía se está grabando: esperá a que termine.'
              : m.status === 'finalizing'
                ? 'Finalizando la grabación…'
                : m.error
                  ? `Grabación parcial: ${m.error}`
                  : null;
            return (
              <View key={m.mission_id}>
                <Pressable
                  style={[styles.row, isExpanded && styles.rowExpanded]}
                  onPress={() => toggleExpand(m.mission_id)}
                >
                  <Text style={styles.rowName} numberOfLines={1}>{m.name}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {formatFecha(m.started_at)} · {formatMissionTime(m.duration_s)}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.statusPill, { borderColor: statusColor(m.status) }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(m.status) }]} />
                    <Text style={[styles.statusText, { color: statusColor(m.status) }]}>{MISSION_STATUS_LABELS[m.status]}</Text>
                  </View>
                  <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={d(16)} color={C.textDim} strokeWidth={2.6} />
                </Pressable>
                {isExpanded && (
                  <MissionPlayer
                    key={m.mission_id}
                    missionId={m.mission_id}
                    ready={ready}
                    statusNote={statusNote}
                    missingStreams={m.missing_streams}
                  />
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(14),
    paddingLeft: d(30),
    paddingRight: d(35),
    paddingTop: d(17),
  },
  backButton: { width: d(49), height: d(49), borderRadius: d(13), backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: VIGA, fontSize: d(22) },
  count: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(12), marginTop: d(4) },

  list: { flex: 1, marginTop: d(20) },
  listContent: { paddingLeft: d(41), paddingRight: d(35), paddingBottom: d(24), gap: d(10) },
  row: {
    height: d(50),
    borderRadius: d(11),
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: d(14),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(12),
  },
  rowExpanded: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderColor: C.red },
  rowName: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14), maxWidth: d(220) },
  rowMeta: { color: C.textDim, fontFamily: HELV, fontSize: d(12), flexShrink: 1 },

  statusPill: {
    height: d(24),
    borderRadius: d(12),
    borderWidth: 1.5,
    paddingHorizontal: d(10),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(6),
  },
  statusDot: { width: d(7), height: d(7), borderRadius: d(3.5) },
  statusText: { fontFamily: HELV, fontWeight: '700', fontSize: d(10.5) },

  // Expanded mission / player
  detail: {
    backgroundColor: '#2F2828',
    borderBottomLeftRadius: d(11),
    borderBottomRightRadius: d(11),
    padding: d(14),
    gap: d(10),
  },
  detailHeading: { color: C.text, fontFamily: VIGA, fontSize: d(13), marginBottom: d(6) },
  videosRow: { flexDirection: 'row', gap: d(14) },
  videoCol: { flex: 1 },
  playerActions: { flexDirection: 'row', gap: d(10) },
  playerButton: {
    height: d(38),
    paddingHorizontal: d(16),
    borderRadius: d(11),
    backgroundColor: C.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerButtonText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },
  disabled: { opacity: 0.5 },

  mapModal: { flex: 1, backgroundColor: '#1c1818' },
  mapClose: {
    position: 'absolute',
    top: d(20),
    right: d(20),
    width: d(42),
    height: d(42),
    borderRadius: d(21),
    backgroundColor: 'rgba(35,30,30,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  empty: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(13), textAlign: 'center', marginTop: d(60) },
  emptySmall: { color: C.textFaint, fontFamily: HELV, fontSize: d(12) },
});
