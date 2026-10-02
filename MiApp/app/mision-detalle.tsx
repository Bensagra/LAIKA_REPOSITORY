import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ServerMission, MissionPlayback,
  getServerMission, missionFileUrl, openMissionPlayback,
  missionPhotoArtifacts, missionAudioArtifacts, formatMissionTime, buildMissionTimeline,
} from '../services/missions';
import { getMissionNotes, setMissionNotes } from '../services/missionLocal';
import Icon, { IconName } from '../components/Icons';
import { C, HELV, VIGA } from '../styles/theme';
import { d } from '../utils/scale';

type TabKey = 'resumen' | 'multimedia' | 'audios' | 'eventos' | 'notas';
const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'resumen', label: 'Resumen', icon: 'grid' },
  { key: 'multimedia', label: 'Multimedia', icon: 'images' },
  { key: 'audios', label: 'Audios', icon: 'mic' },
  { key: 'eventos', label: 'Eventos', icon: 'chart' },
  { key: 'notas', label: 'Notas', icon: 'notes' },
];

function formatFecha(unixSeconds?: number | null) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function formatHora(unixSeconds?: number | null) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// ── Pequeños bloques reutilizados ───────────────────────────────────────────

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function StatCard({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <Icon name={icon} size={d(14)} color={C.textDim} strokeWidth={2.4} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function SubTabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={[styles.subTabBtn, active && styles.subTabBtnActive]} onPress={onPress}>
      <Text style={[styles.subTabText, active && styles.subTabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function ResumenTab({ mission }: { mission: ServerMission }) {
  const photos = missionPhotoArtifacts(mission).length;
  const audios = missionAudioArtifacts(mission).length;
  const videos = (mission.streams?.camera ? 1 : 0) + (mission.streams?.thermal ? 1 : 0);
  return (
    <View style={styles.resumenRow}>
      <View style={styles.detailsPanel}>
        <Text style={styles.panelTitle}>DETALLES</Text>
        <DetailRow label="Operador" value={mission.started_by ?? '—'} />
        <DetailRow label="ID" value={mission.mission_id} />
        <DetailRow label="Robot" value={mission.robot_id} />
        <DetailRow label="Hora de inicio" value={formatHora(mission.started_at)} />
        <DetailRow label="Hora de finalización" value={formatHora(mission.ended_at)} last />
      </View>
      <View style={styles.statsCol}>
        <StatCard icon="clock" label="Duración" value={formatMissionTime(mission.duration_s)} />
        <StatCard icon="mic" label="Audios" value={String(audios)} />
        <StatCard icon="images" label="Fotos y videos" value={`${photos} - ${videos}`} />
      </View>
    </View>
  );
}

function MultimediaTab({ mission }: { mission: ServerMission }) {
  const [filter, setFilter] = useState<'todo' | 'fotos' | 'videos'>('todo');
  const [openTrack, setOpenTrack] = useState<{ key: 'camera' | 'thermal'; label: string } | null>(null);
  const [playback, setPlayback] = useState<MissionPlayback | null>(null);
  const [loadingPlayback, setLoadingPlayback] = useState(false);

  const photos = missionPhotoArtifacts(mission);
  const videoTracks = (['camera', 'thermal'] as const)
    .filter((k) => !!mission.streams?.[k])
    .map((k) => ({ key: k, label: k === 'camera' ? 'Cámara' : 'Térmica' }));

  const showVideos = filter !== 'fotos';
  const showPhotos = filter !== 'videos';

  const openVideo = async (track: { key: 'camera' | 'thermal'; label: string }) => {
    setOpenTrack(track);
    if (playback) return;
    setLoadingPlayback(true);
    try {
      setPlayback(await openMissionPlayback(mission.mission_id));
    } catch {
      // MissionPlayer-style modal below shows nothing playable; close is still available
    } finally {
      setLoadingPlayback(false);
    }
  };

  const empty = videoTracks.length === 0 && photos.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.subTabs}>
        <SubTabBtn label={`Todo | ${videoTracks.length + photos.length}`} active={filter === 'todo'} onPress={() => setFilter('todo')} />
        <SubTabBtn label={`Fotos | ${photos.length}`} active={filter === 'fotos'} onPress={() => setFilter('fotos')} />
        <SubTabBtn label={`Videos | ${videoTracks.length}`} active={filter === 'videos'} onPress={() => setFilter('videos')} />
      </View>
      {empty ? (
        <Text style={styles.emptySmall}>Sin fotos ni videos en esta misión</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {showVideos && videoTracks.map((v) => (
            <TouchableOpacity key={v.key} activeOpacity={0.85} style={styles.tile} onPress={() => openVideo(v)}>
              <View style={styles.tilePlayBadge}>
                <Icon name="play" size={d(12)} color={C.text} />
              </View>
              <Text style={styles.tileLabel}>{v.label}</Text>
            </TouchableOpacity>
          ))}
          {showPhotos && photos.map((path) => (
            <View key={path} style={styles.tile}>
              <Image source={{ uri: missionFileUrl(path) }} style={styles.tileImage} resizeMode="cover" />
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!openTrack} animationType="fade" transparent onRequestClose={() => setOpenTrack(null)}>
        <View style={styles.videoModalOverlay}>
          <TouchableOpacity activeOpacity={0.85} style={styles.mapClose} onPress={() => setOpenTrack(null)}>
            <Icon name="close" size={d(22)} color={C.text} />
          </TouchableOpacity>
          {loadingPlayback && <ActivityIndicator color={C.red} />}
          {!loadingPlayback && Platform.OS === 'web' && playback && openTrack && playback.videos[openTrack.key] && (
            React.createElement('video', {
              src: missionFileUrl(playback.videos[openTrack.key]!.path),
              controls: true,
              autoPlay: true,
              style: { width: '78vw', maxWidth: 900, maxHeight: '80vh', borderRadius: 12, background: '#000' },
            })
          )}
          {!loadingPlayback && (Platform.OS !== 'web' || !playback?.videos[openTrack?.key ?? 'camera']) && (
            <Text style={[styles.emptySmall, { color: C.text }]}>No se pudo abrir este video.</Text>
          )}
        </View>
      </Modal>
    </View>
  );
}

function AudiosTab({ mission }: { mission: ServerMission }) {
  const audios = missionAudioArtifacts(mission);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});

  const toggle = (i: number) => {
    const el = audioRefs.current[i];
    if (!el) return;
    if (playingIdx === i) {
      el.pause();
      setPlayingIdx(null);
      return;
    }
    if (playingIdx != null) audioRefs.current[playingIdx]?.pause();
    el.currentTime = 0;
    el.play().catch(() => {});
    setPlayingIdx(i);
  };

  if (Platform.OS !== 'web') {
    return <Text style={styles.emptySmall}>Reproducción de audio disponible en la versión web</Text>;
  }
  if (!audios.length) {
    return <Text style={styles.emptySmall}>Sin audios en esta misión</Text>;
  }

  return (
    <ScrollView contentContainerStyle={{ gap: d(10), paddingVertical: d(4) }}>
      {audios.map((path, i) => (
        <View key={path} style={styles.audioRow}>
          <TouchableOpacity activeOpacity={0.85} style={styles.audioPlayBtn} onPress={() => toggle(i)}>
            <Icon name={playingIdx === i ? 'pause' : 'play'} size={d(14)} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.audioLabel} numberOfLines={1}>{path.split('/').pop()}</Text>
          {React.createElement('audio', {
            ref: (el: HTMLAudioElement | null) => { audioRefs.current[i] = el; },
            src: missionFileUrl(path),
            onEnded: () => setPlayingIdx((cur) => (cur === i ? null : cur)),
            style: { display: 'none' },
          })}
        </View>
      ))}
    </ScrollView>
  );
}

function EventosTab({ mission }: { mission: ServerMission }) {
  const events = buildMissionTimeline(mission);
  return (
    <ScrollView contentContainerStyle={{ paddingVertical: d(4) }}>
      {events.map((e, i) => (
        <View key={`${e.offsetS}-${i}`} style={[styles.eventRow, i === events.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={styles.eventTime}>{formatMissionTime(e.offsetS)}</Text>
          <Text style={styles.eventLabel}>{e.label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function NotasTab({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[styles.notesInput, (focused || value.length > 0) && styles.notesInputActive]}
      multiline
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="Agregar nota que se guarde en el informe PDF."
      placeholderTextColor={C.textFaint}
      textAlignVertical="top"
    />
  );
}

// ── Pantalla ──────────────────────────────────────────────────────────────────

export default function MisionDetalleScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const missionId = typeof id === 'string' ? id : '';

  const [mission, setMission] = useState<ServerMission | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [notes, setNotes] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!missionId) { setLoading(false); return; }
    getServerMission(missionId).then(setMission).catch(() => setMission(null)).finally(() => setLoading(false));
    getMissionNotes(missionId).then(setNotes);
  }, [missionId]);

  const updateNotes = (text: string) => {
    setNotes(text);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => { setMissionNotes(missionId, text); }, 500);
  };

  const exportReport = () => {
    if (Platform.OS !== 'web' || !mission) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const events = buildMissionTimeline(mission);
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${mission.name}</title>
      <style>
        body{font-family:Helvetica,Arial,sans-serif;padding:32px;color:#222}
        h1{margin-bottom:4px} h2{margin-top:28px;border-bottom:2px solid #E83D3D;padding-bottom:4px}
        table{border-collapse:collapse;width:100%} td{padding:6px 10px;border-bottom:1px solid #ddd;font-size:14px}
        td:first-child{color:#777;width:220px}
        li{margin-bottom:4px;font-size:14px}
        p{white-space:pre-wrap;font-size:14px}
      </style></head><body>
      <h1>${mission.name}</h1>
      <p>${formatFecha(mission.started_at)}</p>
      <h2>Detalles</h2>
      <table>
        <tr><td>Operador</td><td>${mission.started_by ?? '—'}</td></tr>
        <tr><td>ID</td><td>${mission.mission_id}</td></tr>
        <tr><td>Robot</td><td>${mission.robot_id}</td></tr>
        <tr><td>Hora de inicio</td><td>${formatHora(mission.started_at)}</td></tr>
        <tr><td>Hora de finalización</td><td>${formatHora(mission.ended_at)}</td></tr>
        <tr><td>Duración</td><td>${formatMissionTime(mission.duration_s)}</td></tr>
      </table>
      <h2>Eventos</h2>
      <ul>${events.map((e) => `<li>${formatMissionTime(e.offsetS)} — ${e.label}</li>`).join('')}</ul>
      <h2>Notas</h2>
      <p>${(notes || 'Sin notas.').replace(/</g, '&lt;')}</p>
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.85} style={styles.backButton} onPress={() => router.back()}>
          <Icon name="arrowLeft" size={d(24)} strokeWidth={2.6} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{mission?.name ?? 'Misión'}</Text>
          <Text style={styles.subtitle}>{mission ? formatFecha(mission.started_at) : ''}</Text>
        </View>
        <TouchableOpacity activeOpacity={0.85} style={styles.exportBtn} onPress={exportReport} disabled={!mission}>
          <Text style={styles.exportBtnText}>Exportar informe</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={C.red} style={{ marginTop: d(60) }} />
      ) : !mission ? (
        <Text style={styles.empty}>No se pudo cargar esta misión</Text>
      ) : (
        <View style={styles.body}>
          <View style={styles.sidebar}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.key}
                activeOpacity={0.85}
                style={[styles.sideBtn, tab === t.key && styles.sideBtnActive]}
                onPress={() => setTab(t.key)}
              >
                <Icon name={t.icon} size={d(16)} color={tab === t.key ? C.text : C.textDim} strokeWidth={2.4} />
                <Text style={[styles.sideBtnText, tab === t.key && styles.sideBtnTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.content}>
            {tab === 'resumen' && <ResumenTab mission={mission} />}
            {tab === 'multimedia' && <MultimediaTab mission={mission} />}
            {tab === 'audios' && <AudiosTab mission={mission} />}
            {tab === 'eventos' && <EventosTab mission={mission} />}
            {tab === 'notas' && <NotasTab value={notes} onChange={updateNotes} />}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: d(14),
    paddingLeft: d(30), paddingRight: d(35), paddingTop: d(17), paddingBottom: d(14),
  },
  backButton: { width: d(49), height: d(49), borderRadius: d(13), backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontFamily: VIGA, fontSize: d(20) },
  subtitle: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(11), marginTop: d(2) },
  exportBtn: {
    height: d(38), paddingHorizontal: d(18), borderRadius: d(19),
    borderWidth: 1.5, borderColor: C.red, alignItems: 'center', justifyContent: 'center',
  },
  exportBtnText: { color: C.red, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },

  body: { flex: 1, flexDirection: 'row', paddingHorizontal: d(30), paddingBottom: d(20), gap: d(16) },

  sidebar: { width: d(168), gap: d(8) },
  sideBtn: {
    height: d(40), borderRadius: d(10), paddingHorizontal: d(14),
    flexDirection: 'row', alignItems: 'center', gap: d(10), backgroundColor: 'transparent',
  },
  sideBtnActive: { backgroundColor: C.red },
  sideBtnText: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },
  sideBtnTextActive: { color: C.text },

  content: { flex: 1 },

  // Resumen
  resumenRow: { flex: 1, flexDirection: 'row', gap: d(16) },
  detailsPanel: { flex: 1, backgroundColor: C.card, borderRadius: d(14), padding: d(18) },
  panelTitle: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(12), letterSpacing: 1, marginBottom: d(10) },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: d(10), borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { color: C.textDim, fontFamily: HELV, fontSize: d(12.5) },
  detailValue: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5), maxWidth: '60%' },

  statsCol: { width: d(168), gap: d(10) },
  statCard: { backgroundColor: C.card, borderRadius: d(14), padding: d(14), gap: d(8) },
  statHeader: { flexDirection: 'row', alignItems: 'center', gap: d(6) },
  statLabel: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(11) },
  statValue: { color: C.text, fontFamily: VIGA, fontSize: d(22) },

  // Multimedia
  subTabs: { flexDirection: 'row', gap: d(8), marginBottom: d(12) },
  subTabBtn: { height: d(32), paddingHorizontal: d(14), borderRadius: d(16), backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  subTabBtnActive: { backgroundColor: C.red },
  subTabText: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(11.5) },
  subTabTextActive: { color: C.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: d(10) },
  tile: {
    width: d(150), height: d(90), borderRadius: d(10), backgroundColor: C.card,
    overflow: 'hidden', justifyContent: 'flex-end',
  },
  tileImage: { width: '100%', height: '100%' },
  tilePlayBadge: {
    position: 'absolute', top: '50%', left: '50%', marginTop: -d(14), marginLeft: -d(14),
    width: d(28), height: d(28), borderRadius: d(14), backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { color: C.textDim, fontFamily: HELV, fontSize: d(10), padding: d(6) },

  videoModalOverlay: { flex: 1, backgroundColor: 'rgba(10,8,8,0.92)', alignItems: 'center', justifyContent: 'center' },
  mapClose: {
    position: 'absolute', top: d(20), right: d(20), width: d(42), height: d(42), borderRadius: d(21),
    backgroundColor: 'rgba(53,45,45,0.9)', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },

  // Audios
  audioRow: {
    height: d(46), borderRadius: d(10), backgroundColor: C.card, paddingHorizontal: d(12),
    flexDirection: 'row', alignItems: 'center', gap: d(10),
  },
  audioPlayBtn: { width: d(30), height: d(30), borderRadius: d(15), backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  audioLabel: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(12), flex: 1 },

  // Eventos
  eventRow: {
    flexDirection: 'row', gap: d(16), paddingVertical: d(11),
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  eventTime: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(12), width: d(50) },
  eventLabel: { color: C.text, fontFamily: HELV, fontSize: d(12.5) },

  // Notas
  notesInput: {
    flex: 1, backgroundColor: C.card, borderRadius: d(14), padding: d(16),
    color: C.text, fontFamily: HELV, fontSize: d(13), borderWidth: 1.5, borderColor: 'transparent',
  },
  notesInputActive: { borderColor: C.red },

  empty: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(13), textAlign: 'center', marginTop: d(60) },
  emptySmall: { color: C.textFaint, fontFamily: HELV, fontSize: d(12) },
});
