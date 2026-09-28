import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Pressable,
  StyleSheet, ActivityIndicator, Platform, Alert, Linking,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  formatMissionTime,
  listServerMissions,
  loadMissionMap,
  MISSION_FILE_LABELS,
  MISSION_STATUS_LABELS,
  missionFileUrl,
  missionIsReady,
  MissionPlayback,
  openMissionPlayback,
  requestMissionDownload,
  ServerMission,
} from '../services/missions';
import LidarReconstruction, { LidarSink } from '../components/LidarReconstruction';
import { d } from '../utils/scale';

const RED = '#E83D3D';
const BG = '#292222';
const PANEL = '#453A3A';
const MONO = Platform.OS === 'web' ? '"JetBrains Mono", monospace' : 'monospace';

// Sync rules from the missions guide: 0.4 s drift tolerance, 0.5x/1x/2x speeds.
const DRIFT_TOLERANCE_S = 0.4;
const SPEEDS = [0.5, 1, 2] as const;
const RENEW_MARGIN_S = 60;

type VideoKey = 'camera' | 'thermal';
type TileKey = 'camera' | 'lidar' | 'thermal' | 'ir';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatFecha(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const MoreDots = () => (
  <View style={styles.dots}>
    <View style={styles.dot} />
    <View style={styles.dot} />
    <View style={styles.dot} />
  </View>
);

const TopButton = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <TouchableOpacity style={styles.topButton} onPress={onPress} activeOpacity={0.8}>
    <Text style={styles.topButtonText}>{label}</Text>
  </TouchableOpacity>
);

function StatusTag({ mission }: { mission: ServerMission }) {
  if (mission.status === 'completed') return null;
  const warn = mission.status === 'error' || mission.status === 'interrupted';
  return <Text style={[styles.statusTag, warn && styles.statusTagWarn]}>{MISSION_STATUS_LABELS[mission.status]}</Text>;
}

// ── Downloads ────────────────────────────────────────────────────────────────

function DownloadsPanel({ mission, onClose }: { mission: ServerMission; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Ticket links the browser refused to open as a popup (e.g. after a slow ZIP).
  const [pendingLinks, setPendingLinks] = useState<Record<string, string>>({});
  const ready = missionIsReady(mission);

  // New tab: the file lives on another origin, so an in-page link would
  // navigate away from the app instead of downloading.
  const openLink = (filename: string, url: string) => {
    if (Platform.OS !== 'web') { Linking.openURL(url).catch(() => {}); return true; }
    // Not the 'noopener' feature: with it window.open always returns null and
    // a blocked popup would be indistinguishable. Detach the opener instead.
    const opened = window.open(url, '_blank');
    if (!opened) return false;
    opened.opener = null;
    setPendingLinks(({ [filename]: _, ...rest }) => rest);
    return true;
  };

  const download = async (filename: string) => {
    setBusy(filename);
    setMessage(filename === 'mission.zip' ? 'Preparando ZIP… puede tardar.' : null);
    try {
      const url = await requestMissionDownload(mission.mission_id, filename);
      if (!openLink(filename, url)) {
        setPendingLinks((prev) => ({ ...prev, [filename]: url }));
        setMessage('El navegador bloqueó la ventana: tocá ABRIR para descargar (enlace válido 10 min).');
        return;
      }
      setMessage(null);
    } catch (e) {
      setMessage(`No se pudo descargar ${filename}: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <Pressable style={styles.downloadsPanel}>
        <View style={styles.downloadsHeader}>
          <Text style={styles.panelTitle}>DESCARGAS</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={styles.panelClose}>✕</Text></TouchableOpacity>
        </View>
        {!ready && <Text style={styles.panelHint}>La misión todavía se está guardando; las descargas se habilitan al terminar.</Text>}
        {(mission.status === 'error' || mission.status === 'interrupted') && (
          <Text style={styles.panelWarn}>Grabación parcial{mission.error ? `: ${mission.error}` : ''}. Se ofrecen los archivos disponibles.</Text>
        )}
        <ScrollView style={{ maxHeight: d(210) }}>
          {[...mission.artifacts, 'mission.zip'].map((filename) => (
            <View key={filename} style={styles.fileRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName}>{filename}</Text>
                <Text style={styles.fileLabel}>{MISSION_FILE_LABELS[filename] ?? ''}</Text>
              </View>
              {pendingLinks[filename] ? (
                <TouchableOpacity onPress={() => openLink(filename, pendingLinks[filename])} style={[styles.fileButton, styles.fileButtonReady]}>
                  <Text style={[styles.fileButtonText, { color: '#fff' }]}>ABRIR</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={!ready || busy !== null}
                  onPress={() => download(filename)}
                  style={[styles.fileButton, (!ready || busy !== null) && { opacity: 0.4 }]}
                >
                  {busy === filename
                    ? <ActivityIndicator color={RED} size="small" />
                    : <Text style={styles.fileButtonText}>DESCARGAR</Text>}
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
        {message && <Text style={styles.panelHint}>{message}</Text>}
      </Pressable>
    </Pressable>
  );
}

// ── Player: 4 views on one mission timeline ────────────────────────────────

function MissionPlayer({ mission, onBack }: { mission: ServerMission; onBack: () => void }) {
  const [playback, setPlayback] = useState<MissionPlayback | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayTime, setDisplayTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [videoStatus, setVideoStatus] = useState<Record<VideoKey, string>>({ camera: '', thermal: '' });
  const [mapStatus, setMapStatus] = useState('cargando mapa…');
  const [expanded, setExpanded] = useState<TileKey | null>(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [trackWidth, setTrackWidth] = useState(1);

  const duration = Math.max(0, playback?.mission.duration_s ?? mission.duration_s);
  const clock = useRef({ time: 0, playing: false, speed: 1 });
  const videoRefs = useRef<Record<VideoKey, HTMLVideoElement | null>>({ camera: null, thermal: null });
  const playbackRef = useRef<MissionPlayback | null>(null);
  const expiresAtRef = useRef(0);
  const generationRef = useRef(0);
  const lidarSinkRef = useRef<LidarSink | null>(null);
  const lastTapRef = useRef<{ key: TileKey | null; at: number }>({ key: null, at: 0 });

  clock.current.playing = playing;
  clock.current.speed = speed;

  // Ask for (or renew) the 10-minute playback tickets. The mission clock is
  // independent of the <video> elements, so time and pause state survive a renew.
  const loadPlayback = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const result = await openMissionPlayback(mission.mission_id);
      if (generation !== generationRef.current) return; // stale response
      playbackRef.current = result;
      expiresAtRef.current = Date.now() + result.expires_in_s * 1000;
      setPlayback(result);
      setLoadError(null);
    } catch (e) {
      if (generation === generationRef.current) setLoadError(errorText(e));
    }
  }, [mission.mission_id]);

  useEffect(() => {
    loadPlayback();
    const renewTimer = setInterval(() => {
      if (expiresAtRef.current && Date.now() > expiresAtRef.current - RENEW_MARGIN_S * 1000) loadPlayback();
    }, 15000);
    // A suspended tab may come back with expired tickets.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() > expiresAtRef.current - RENEW_MARGIN_S * 1000) loadPlayback();
    };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', onVisible);
    return () => {
      generationRef.current++;
      clearInterval(renewTimer);
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onVisible);
      for (const video of Object.values(videoRefs.current)) {
        if (!video) continue;
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [loadPlayback]);

  // Accumulated LiDAR map (not a time series: it doesn't follow the timeline).
  const mapPath = playback?.map_path ?? null;
  const hasPlayback = !!playback;
  useEffect(() => {
    if (!hasPlayback) return;
    if (!mapPath) { setMapStatus('sin mapa'); return; }
    let alive = true;
    setMapStatus('cargando mapa…');
    loadMissionMap(mapPath)
      .then((points) => {
        if (!alive) return;
        lidarSinkRef.current?.clear();
        lidarSinkRef.current?.addFrame({ points, colors: null, mode: 'keyframe' });
        setMapStatus(`mapa acumulado · ${Math.floor(points.length / 3).toLocaleString()} pts`);
      })
      .catch((e) => { if (alive) setMapStatus(`error: ${errorText(e)}`); });
    return () => { alive = false; };
  }, [mapPath, hasPlayback]);

  // Put every video where the mission clock says it should be.
  const syncVideos = useCallback((seekExactly = false) => {
    const current = playbackRef.current;
    if (!current) return;
    const t = clock.current.time;
    const nextStatus: Record<VideoKey, string> = { camera: '', thermal: '' };
    for (const key of ['camera', 'thermal'] as VideoKey[]) {
      const track = current.videos[key];
      const video = videoRefs.current[key];
      if (!track) { nextStatus[key] = 'sin video'; continue; }
      if (!video || !(video.readyState >= 1)) { nextStatus[key] = 'cargando'; continue; }
      const local = t - track.offset_s;
      if (local < 0) {
        if (!video.paused) video.pause();
        if (video.currentTime !== 0) video.currentTime = 0;
        nextStatus[key] = 'todavía no había comenzado';
      } else if (t > track.last_at_s) {
        if (!video.paused) video.pause();
        nextStatus[key] = 'fin de grabación';
      } else {
        const target = Math.min(local, Math.max(0, video.duration - 0.001));
        if (seekExactly || Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_S) video.currentTime = target;
        video.playbackRate = clock.current.speed;
        if (clock.current.playing && video.paused) video.play().catch(() => {});
        if (!clock.current.playing && !video.paused) video.pause();
        nextStatus[key] = video.seeking || video.readyState < 3 ? 'cargando' : '';
      }
    }
    setVideoStatus((prev) => (prev.camera === nextStatus.camera && prev.thermal === nextStatus.thermal ? prev : nextStatus));
  }, []);

  // Common clock: advances with the selected speed and waits for any video
  // that is needed right now but still seeking/buffering.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const current = playbackRef.current;
      if (clock.current.playing && current) {
        const t = clock.current.time;
        const waiting = (['camera', 'thermal'] as VideoKey[]).some((key) => {
          const track = current.videos[key];
          const video = videoRefs.current[key];
          if (!track || !video) return false;
          const active = t >= track.offset_s && t <= track.last_at_s;
          return active && (video.seeking || video.readyState < 3);
        });
        if (!waiting) clock.current.time = Math.min(duration, t + dt * clock.current.speed);
        if (clock.current.time >= duration) {
          clock.current.time = duration;
          setPlaying(false);
        }
      }
      syncVideos();
      if (now - lastUi > 200) {
        lastUi = now;
        setDisplayTime(clock.current.time);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, syncVideos]);

  const seekTo = (t: number) => {
    clock.current.time = Math.min(Math.max(0, t), duration);
    setDisplayTime(clock.current.time);
    syncVideos(true);
  };

  const togglePlay = () => {
    if (!playing && clock.current.time >= duration) seekTo(0);
    setPlaying((p) => !p);
  };

  const onTrack = (x: number) => seekTo((x / trackWidth) * duration);

  const handleTileTap = (key: TileKey) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.key === key && now - last.at < 350) {
      setExpanded((current) => (current === key ? null : key));
      lastTapRef.current = { key: null, at: 0 };
    } else {
      lastTapRef.current = { key, at: now };
    }
  };

  const m = playback?.mission ?? mission;
  const partial = m.status === 'error' || m.status === 'interrupted';

  const videoTile = (key: VideoKey) => {
    const track = playback?.videos[key];
    if (Platform.OS !== 'web') {
      return <View style={styles.tileEmpty}><Text style={styles.tileEmptyText}>REPRODUCCIÓN DISPONIBLE EN LA WEB</Text></View>;
    }
    if (!track) {
      return <View style={styles.tileEmpty}><Text style={styles.tileEmptyText}>{playback ? 'SIN VIDEO' : ''}</Text></View>;
    }
    return React.createElement('video', {
      ref: (el: HTMLVideoElement | null) => { videoRefs.current[key] = el; },
      src: missionFileUrl(track.path),
      preload: 'metadata',
      playsInline: true,
      muted: true,
      onLoadedMetadata: () => syncVideos(true),
      style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' },
    });
  };

  const tiles: { key: TileKey; label: string; status: string; content: React.ReactNode }[] = [
    { key: 'camera', label: 'CÁMARA', status: videoStatus.camera, content: videoTile('camera') },
    {
      key: 'lidar',
      label: 'LIDAR',
      status: loadError && !playback ? 'no disponible' : mapStatus,
      content: Platform.OS === 'web'
        ? <LidarReconstruction sinkRef={lidarSinkRef} voxelSize={m.voxel_size_m ?? 0.08} />
        : <View style={styles.tileEmpty}><Text style={styles.tileEmptyText}>MAPA DISPONIBLE EN LA WEB</Text></View>,
    },
    { key: 'thermal', label: 'TÉRMICA', status: videoStatus.thermal, content: videoTile('thermal') },
    {
      key: 'ir',
      label: 'INFRARROJA',
      status: 'no se graba',
      content: <View style={styles.tileEmpty}><Text style={styles.tileEmptyText}>SIN DATOS</Text></View>,
    },
  ];

  // Coverage of each stream on the mission timeline (from the manifest).
  const coverage = (['camera', 'thermal', 'lidar'] as const).map((key) => {
    const s = m.streams?.[key];
    if (!s || s.first_at_s == null || s.last_at_s == null || !duration) return null;
    return { key, left: s.first_at_s / duration, width: Math.max(0, s.last_at_s - s.first_at_s) / duration };
  });

  const progress = duration ? displayTime / duration : 0;

  return (
    <View style={styles.window}>
      <View style={styles.grid}>
        {tiles.map((tile, index) => {
          const isExpanded = expanded === tile.key;
          const hidden = expanded !== null && !isExpanded;
          return (
            <Pressable
              key={tile.key}
              onPress={() => handleTileTap(tile.key)}
              style={[
                styles.tile,
                index % 2 === 0 && styles.tileLeftCol,
                index < 2 && styles.tileTopRow,
                isExpanded && styles.tileExpanded,
                hidden && styles.tileHidden,
              ]}
            >
              {tile.content}
              <View pointerEvents="none" style={[styles.tileLabel, isExpanded ? styles.tileLabelExpanded : LABEL_CORNERS[index]]}>
                <Text style={styles.tileLabelText}>{tile.label}</Text>
                {!!tile.status && <Text style={styles.tileLabelStatus}>{tile.status}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.playerTopBar} pointerEvents="box-none">
        <View style={styles.playerTopLeft}>
          <TopButton label="BACK" onPress={onBack} />
          {expanded && <TopButton label="4 VISTAS" onPress={() => setExpanded(null)} />}
        </View>
        <Text style={styles.playerTitle} numberOfLines={1}>{m.name.toUpperCase()}</Text>
        <TouchableOpacity style={styles.downloadsButton} onPress={() => setDownloadsOpen(true)} activeOpacity={0.8}>
          <Text style={styles.downloadsButtonText}>DESCARGAS</Text>
        </TouchableOpacity>
      </View>

      {(partial || loadError) && (
        <View style={styles.banner} pointerEvents="none">
          <Text style={styles.bannerText}>
            {loadError ? `No se pudo abrir la misión: ${loadError}` : `Grabación parcial${m.error ? `: ${m.error}` : ''}`}
          </Text>
        </View>
      )}

      <View style={styles.timelineBar}>
        <TouchableOpacity onPress={togglePlay} style={styles.playButton} disabled={!playback}>
          <Text style={styles.playButtonText}>{playing ? '❚❚' : '▶'}</Text>
        </TouchableOpacity>
        <Text style={styles.timeText}>{formatMissionTime(displayTime)} / {formatMissionTime(duration)}</Text>
        <View
          style={styles.trackArea}
          onLayout={(e) => setTrackWidth(Math.max(1, e.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => onTrack(e.nativeEvent.locationX)}
          onResponderMove={(e) => onTrack(e.nativeEvent.locationX)}
        >
          <View style={styles.coverageRows} pointerEvents="none">
            {coverage.map((c, i) => (
              <View key={i} style={styles.coverageRow}>
                {c && <View style={[styles.coverageFill, COVERAGE_COLORS[c.key], { left: `${c.left * 100}%`, width: `${c.width * 100}%` }]} />}
              </View>
            ))}
          </View>
          <View style={styles.track} pointerEvents="none">
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={[styles.trackThumb, { left: `${progress * 100}%` }]} pointerEvents="none" />
        </View>
        <View style={styles.speedGroup}>
          {SPEEDS.map((v) => (
            <TouchableOpacity key={v} onPress={() => setSpeed(v)} style={[styles.speedChip, speed === v && styles.speedChipActive]}>
              <Text style={[styles.speedText, speed === v && styles.speedTextActive]}>{v === 0.5 ? '0,5×' : `${v}×`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {downloadsOpen && <DownloadsPanel mission={m} onClose={() => setDownloadsOpen(false)} />}
    </View>
  );
}

// Label corner per grid tile (TL, TR, BL, BR): the corner nearest the center.
const LABEL_CORNERS = [
  { right: 8, bottom: 8, alignItems: 'flex-end' as const },
  { left: 8, bottom: 8 },
  { right: 8, top: 8, alignItems: 'flex-end' as const },
  { left: 8, top: 8 },
];

const COVERAGE_COLORS = {
  camera: { backgroundColor: '#E83D3D' },
  thermal: { backgroundColor: '#ffb347' },
  lidar: { backgroundColor: '#45d483' },
};

// ── Library ──────────────────────────────────────────────────────────────────

function MissionRow({ mission, onOpen, onMore }: { mission: ServerMission; onOpen: () => void; onMore: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onOpen}>
      <View style={styles.rowTitle}>
        <Text style={styles.rowText} numberOfLines={1}>{mission.name.toUpperCase()}</Text>
        <StatusTag mission={mission} />
      </View>
      <TouchableOpacity onPress={onMore} hitSlop={10} style={styles.moreButton}>
        <MoreDots />
      </TouchableOpacity>
    </Pressable>
  );
}

function MissionPreviewCard({ mission, onClose, onOpen, onDownloads }: {
  mission: ServerMission;
  onClose: () => void;
  onOpen: () => void;
  onDownloads: () => void;
}) {
  const ready = missionIsReady(mission);
  const frames = (key: 'camera' | 'thermal' | 'lidar') => mission.streams?.[key]?.frames ?? 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.rowText} numberOfLines={1}>{mission.name.toUpperCase()}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.cardMore}>
          <MoreDots />
        </TouchableOpacity>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardMeta}>{formatFecha(mission.started_at)} · {formatMissionTime(mission.duration_s)}</Text>
        <Text style={styles.cardMeta}>{MISSION_STATUS_LABELS[mission.status]}{mission.error ? ` · ${mission.error}` : ''}</Text>
        <Text style={styles.cardMeta}>cámara {frames('camera')} · térmica {frames('thermal')} · lidar {frames('lidar')} cuadros</Text>
        {!!mission.lidar_points && <Text style={styles.cardMeta}>mapa {mission.lidar_points.toLocaleString()} pts</Text>}
        {!!mission.missing_streams?.length && <Text style={styles.cardWarn}>sin: {mission.missing_streams.join(', ')}</Text>}
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity onPress={onOpen} disabled={!ready} style={!ready && { opacity: 0.4 }}>
          <Text style={styles.cardAction}>ABRIR</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDownloads}><Text style={styles.cardAction}>DESCARGAS</Text></TouchableOpacity>
      </View>
    </View>
  );
}

export default function DataScreen() {
  const router = useRouter();
  const [missions, setMissions] = useState<ServerMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [downloadsId, setDownloadsId] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setMissions(await listServerMissions());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // While a mission is still recording/finalizing, refresh every 3 s.
  const anyActive = missions.some((m) => !missionIsReady(m));
  useEffect(() => {
    if (!anyActive || playerId) return;
    const interval = setInterval(() => load(true), 3000);
    return () => clearInterval(interval);
  }, [anyActive, load, playerId]);

  const openPlayer = (mission: ServerMission) => {
    if (!missionIsReady(mission)) {
      Alert.alert('Misión', 'La misión todavía se está grabando o guardando. Se podrá reproducir cuando termine.');
      return;
    }
    setPreviewId(null);
    setPlayerId(mission.mission_id);
  };

  const player = missions.find((m) => m.mission_id === playerId);
  if (player) return <MissionPlayer mission={player} onBack={() => { setPlayerId(null); load(true); }} />;

  const preview = missions.find((m) => m.mission_id === previewId);
  const downloads = missions.find((m) => m.mission_id === downloadsId);

  return (
    <View style={styles.window}>
      <View style={styles.topBar}>
        <TopButton label="HOME" onPress={() => router.replace('/')} />
      </View>

      {loading ? (
        <ActivityIndicator color={RED} style={{ marginTop: d(112) }} />
      ) : error && !missions.length ? (
        <View style={{ marginTop: d(112), alignItems: 'center', gap: d(10) }}>
          <Text style={styles.emptyText}>No se pudo conectar con el servidor: {error}</Text>
          <TopButton label="REINTENTAR" onPress={() => load()} />
        </View>
      ) : preview ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewId(null)}>
          <Pressable style={styles.cardPosition}>
            <MissionPreviewCard
              mission={preview}
              onClose={() => setPreviewId(null)}
              onOpen={() => openPlayer(preview)}
              onDownloads={() => { setPreviewId(null); setDownloadsId(preview.mission_id); }}
            />
          </Pressable>
        </Pressable>
      ) : missions.length === 0 ? (
        <Text style={[styles.emptyText, { marginTop: d(112) }]}>No hay misiones grabadas en el servidor</Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {missions.map((m) => (
            <MissionRow
              key={m.mission_id}
              mission={m}
              onOpen={() => openPlayer(m)}
              onMore={() => setPreviewId(m.mission_id)}
            />
          ))}
        </ScrollView>
      )}

      {downloads && <DownloadsPanel mission={downloads} onClose={() => setDownloadsId(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: BG },

  topBar: { position: 'absolute', top: d(16), left: d(20), zIndex: 10 },
  topButton: {
    height: d(22),
    paddingHorizontal: d(13),
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(41,34,34,0.85)',
  },
  topButtonText: { color: RED, fontFamily: MONO, fontSize: d(12) },

  scroll: { flex: 1, marginTop: d(110) },
  scrollContent: { paddingHorizontal: d(22), paddingBottom: d(20), gap: d(17) },

  row: {
    height: d(52),
    borderWidth: 2,
    borderColor: RED,
    borderRadius: 5,
    backgroundColor: PANEL,
    paddingLeft: d(20),
    paddingRight: d(22),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: d(12), flexShrink: 1 },
  rowText: { color: RED, fontFamily: MONO, fontSize: d(18), letterSpacing: 1, flexShrink: 1 },
  statusTag: { color: '#F8E3E3', fontFamily: MONO, fontSize: d(10), letterSpacing: 0.5 },
  statusTagWarn: { color: '#ffb347' },
  moreButton: { paddingVertical: d(8), paddingLeft: d(8) },

  dots: { flexDirection: 'row', gap: d(3) },
  dot: { width: d(3), height: d(3), borderRadius: d(1.5), backgroundColor: RED },

  cardPosition: { position: 'absolute', top: d(113), left: d(213) },
  card: {
    width: d(240),
    minHeight: d(224),
    borderWidth: 2,
    borderColor: RED,
    borderRadius: 5,
    backgroundColor: PANEL,
    paddingHorizontal: d(20),
    paddingTop: d(16),
    paddingBottom: d(14),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: d(8) },
  cardMore: { marginTop: d(-6), marginRight: d(-10), padding: d(4) },
  cardBody: { flex: 1, marginTop: d(14), gap: d(4) },
  cardMeta: { color: '#9a8585', fontFamily: MONO, fontSize: d(10) },
  cardWarn: { color: '#ffb347', fontFamily: MONO, fontSize: d(10) },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: d(12) },
  cardAction: { color: RED, fontFamily: MONO, fontSize: d(11), letterSpacing: 0.5 },

  emptyText: { color: '#6b5555', fontFamily: MONO, fontSize: 13, textAlign: 'center', paddingHorizontal: d(40) },

  // Player
  grid: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '50%', height: '50%', overflow: 'hidden', borderColor: '#3a2e2e', backgroundColor: '#1c1818' },
  tileLeftCol: { borderRightWidth: 1 },
  tileTopRow: { borderBottomWidth: 1 },
  tileExpanded: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    borderRightWidth: 0,
    borderBottomWidth: 0,
    zIndex: 1,
  },
  tileHidden: { display: 'none' },
  tileEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileEmptyText: { color: '#4a3c3c', fontFamily: MONO, fontSize: d(11), letterSpacing: 1 },
  tileLabel: {
    position: 'absolute',
    paddingHorizontal: d(6),
    paddingVertical: d(3),
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tileLabelExpanded: { left: d(18), top: d(46) },
  tileLabelText: { color: RED, fontFamily: MONO, fontSize: d(10), fontWeight: '500', letterSpacing: 1 },
  tileLabelStatus: { color: '#9a8585', fontFamily: MONO, fontSize: d(8) },

  playerTopBar: {
    position: 'absolute',
    top: d(14),
    left: d(18),
    right: d(16),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  playerTopLeft: { flexDirection: 'row', gap: d(8) },
  playerTitle: {
    position: 'absolute',
    left: d(160),
    right: d(160),
    textAlign: 'center',
    color: RED,
    fontFamily: MONO,
    fontSize: d(14),
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
  },
  downloadsButton: {
    height: d(22),
    paddingHorizontal: d(12),
    backgroundColor: '#C0C0C0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadsButtonText: { color: '#171717', fontFamily: MONO, fontSize: d(11), fontWeight: '500' },

  banner: {
    position: 'absolute',
    top: d(44),
    alignSelf: 'center',
    paddingHorizontal: d(10),
    paddingVertical: d(4),
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 5,
  },
  bannerText: { color: '#ffb347', fontFamily: MONO, fontSize: d(10) },

  timelineBar: {
    position: 'absolute',
    bottom: d(13),
    left: d(40),
    right: d(40),
    height: d(48),
    borderRadius: d(24),
    backgroundColor: 'rgba(67, 58, 58, 0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: d(14),
    gap: d(12),
    zIndex: 5,
  },
  playButton: {
    width: d(30),
    height: d(30),
    borderRadius: d(15),
    borderWidth: 1.5,
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonText: { color: RED, fontSize: d(11), fontFamily: MONO },
  timeText: { color: '#F8E3E3', fontFamily: MONO, fontSize: d(10), minWidth: d(90) },
  trackArea: { flex: 1, height: d(30), justifyContent: 'center' },
  coverageRows: { position: 'absolute', top: d(3), left: 0, right: 0, gap: d(1) },
  coverageRow: { height: d(2), position: 'relative' },
  coverageFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 1, opacity: 0.8 },
  track: { height: d(4), borderRadius: d(2), backgroundColor: '#2a2222', marginTop: d(8), overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: RED },
  trackThumb: {
    position: 'absolute',
    top: d(15),
    width: d(12),
    height: d(12),
    marginLeft: d(-6),
    borderRadius: d(6),
    backgroundColor: '#F8E3E3',
  },
  speedGroup: { flexDirection: 'row', gap: d(4) },
  speedChip: { paddingHorizontal: d(6), paddingVertical: d(3), borderRadius: 3, borderWidth: 1, borderColor: '#6a4a4b' },
  speedChipActive: { borderColor: RED, backgroundColor: 'rgba(232,61,61,0.15)' },
  speedText: { color: '#8b7474', fontFamily: MONO, fontSize: d(9) },
  speedTextActive: { color: RED },

  // Downloads
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  downloadsPanel: {
    width: d(460),
    maxWidth: '92%',
    borderWidth: 2,
    borderColor: RED,
    borderRadius: 5,
    backgroundColor: PANEL,
    padding: d(16),
    gap: d(8),
  },
  downloadsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { color: RED, fontFamily: MONO, fontSize: d(14), letterSpacing: 1 },
  panelClose: { color: RED, fontFamily: MONO, fontSize: d(14) },
  panelHint: { color: '#9a8585', fontFamily: MONO, fontSize: d(10) },
  panelWarn: { color: '#ffb347', fontFamily: MONO, fontSize: d(10) },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(10),
    paddingVertical: d(6),
    borderBottomWidth: 1,
    borderBottomColor: '#3a2e2e',
  },
  fileName: { color: '#F8E3E3', fontFamily: MONO, fontSize: d(11) },
  fileLabel: { color: '#9a8585', fontFamily: MONO, fontSize: d(9) },
  fileButton: {
    minWidth: d(86),
    height: d(22),
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileButtonText: { color: RED, fontFamily: MONO, fontSize: d(10) },
  fileButtonReady: { backgroundColor: RED },
});
