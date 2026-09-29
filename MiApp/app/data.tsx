import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  actualizarDatosMision,
  contenidoDeMision,
  eliminarMision,
  getMisiones,
  MisionEvento,
  MisionGaleriaItem,
  MisionResumen,
} from '../services/api';
import { deleteMissionVideo, getMissionVideoUrl } from '../services/misionMedia';
import Icon from '../components/Icons';
import { C, formatClock, HELV, VIGA } from '../styles/theme';
import { d } from '../utils/scale';

// "Misiones" (PDF pages 3 and 4): list, edit/select mode, and an expandable
// panel per mission with its action timeline and photo/video carousel.

function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function missionMeta(m: MisionResumen) {
  const { ubicacion } = contenidoDeMision(m.descripcion);
  return ubicacion ? `${formatFecha(m.created_at)} | ${ubicacion}` : formatFecha(m.created_at);
}

// ── Expanded panel ──────────────────────────────────────────────────────────

function Timeline({ eventos }: { eventos: MisionEvento[] }) {
  if (!eventos.length) return <Text style={styles.emptySmall}>Sin acciones registradas</Text>;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: d(4) }}>
      {eventos.map((e, i) => (
        <View key={i} style={styles.eventRow}>
          <View style={styles.eventRail}>
            <View style={[styles.eventDot, (e.tipo === 'foto' || e.tipo === 'video') && styles.eventDotMedia]} />
            {i < eventos.length - 1 && <View style={styles.eventLine} />}
          </View>
          <View style={styles.eventBody}>
            <Text style={styles.eventTime}>{formatClock(e.t)}</Text>
            <Text style={styles.eventText}>{e.texto}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function MediaCarousel({ items }: { items: MisionGaleriaItem[] }) {
  const [index, setIndex] = useState(0);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    Promise.all(items.filter((it) => it.tipo === 'video' && it.videoId).map(async (it) => {
      const url = await getMissionVideoUrl(it.videoId!);
      if (url) urls.push(url);
      return [it.id, url] as const;
    })).then((entries) => {
      if (alive) setVideoUrls(Object.fromEntries(entries.filter(([, url]) => !!url)) as Record<string, string>);
    }).catch(() => {});
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [items]);

  if (!items.length) return <View style={styles.carouselEmpty}><Text style={styles.emptySmall}>Sin fotos ni videos</Text></View>;

  const item = items[Math.min(index, items.length - 1)];
  const go = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length);

  return (
    <View style={styles.carousel}>
      <View style={styles.carouselFrame}>
        {item.tipo === 'captura' && item.uri ? (
          <Image source={{ uri: item.uri }} style={styles.carouselMedia} resizeMode="contain" />
        ) : videoUrls[item.id] && Platform.OS === 'web' ? (
          React.createElement('video', {
            key: item.id,
            src: videoUrls[item.id],
            controls: true,
            style: { width: '100%', height: '100%', objectFit: 'contain', background: '#000' },
          })
        ) : (
          <Text style={styles.emptySmall}>{item.tipo === 'video' ? 'Video no disponible en este dispositivo' : 'Imagen no disponible'}</Text>
        )}
        {items.length > 1 && (
          <>
            <TouchableOpacity style={[styles.carouselArrow, { left: d(8) }]} onPress={() => go(-1)}>
              <Icon name="chevronLeft" size={d(18)} strokeWidth={2.8} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.carouselArrow, { right: d(8) }]} onPress={() => go(1)}>
              <Icon name="chevronRight" size={d(18)} strokeWidth={2.8} />
            </TouchableOpacity>
          </>
        )}
      </View>
      <View style={styles.carouselFooter}>
        <Text style={styles.carouselCaption}>
          {item.tipo === 'captura' ? 'Foto' : `Video${item.duracionMs ? ` · ${formatClock(item.duracionMs / 1000).slice(3)}` : ''}`}
        </Text>
        <View style={styles.carouselDots}>
          {items.map((it, i) => (
            <Pressable key={it.id} hitSlop={4} onPress={() => setIndex(i)}>
              <View style={[styles.carouselDot, i === index && styles.carouselDotActive]} />
            </Pressable>
          ))}
        </View>
        <Text style={styles.carouselCaption}>{index + 1}/{items.length}</Text>
      </View>
    </View>
  );
}

function MissionDetail({ mission }: { mission: MisionResumen }) {
  const c = contenidoDeMision(mission.descripcion);
  const info = [
    c.operador ? `Operador: ${c.operador}` : null,
    c.ubicacion ? `Ubicación: ${c.ubicacion}` : null,
    c.duracion_s != null ? `Duración: ${formatClock(c.duracion_s)}` : null,
  ].filter(Boolean).join('   ·   ');
  return (
    <View style={styles.detail}>
      {!!info && <Text style={styles.detailInfo}>{info}</Text>}
      <View style={styles.detailColumns}>
        <View style={styles.timelineColumn}>
          <Text style={styles.detailHeading}>Línea de tiempo</Text>
          <Timeline eventos={c.eventos ?? []} />
        </View>
        <View style={styles.mediaColumn}>
          <MediaCarousel items={c.galeria} />
        </View>
      </View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function DataScreen() {
  const router = useRouter();
  const [missions, setMissions] = useState<MisionResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ id: number; nombre: string; operador: string; ubicacion: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { const list = await getMisiones(); if (mounted.current) setMissions(list); }
    catch { if (mounted.current) setMissions([]); }
    finally { if (mounted.current) setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleEditing = () => {
    setEditing((v) => !v);
    setSelected(new Set());
    setExpandedId(null);
  };

  const toggleSelected = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openEditForm = () => {
    if (selected.size !== 1) return;
    const m = missions.find((x) => selected.has(x.id_mision));
    if (!m) return;
    const c = contenidoDeMision(m.descripcion);
    setEditForm({ id: m.id_mision, nombre: m.nombre, operador: c.operador ?? '', ubicacion: c.ubicacion ?? '' });
  };

  const saveEditForm = async () => {
    if (!editForm) return;
    setBusy(true);
    await actualizarDatosMision(editForm.id, {
      nombre: editForm.nombre.trim() || 'Misión',
      operador: editForm.operador.trim(),
      ubicacion: editForm.ubicacion.trim(),
    });
    setBusy(false);
    setEditForm(null);
    await load();
  };

  const deleteSelected = async () => {
    setBusy(true);
    for (const id of selected) {
      const m = missions.find((x) => x.id_mision === id);
      // Videos live in this browser's IndexedDB: free them too.
      for (const item of contenidoDeMision(m?.descripcion ?? null).galeria) {
        if (item.videoId) await deleteMissionVideo(item.videoId).catch(() => {});
      }
      await eliminarMision(id);
    }
    setBusy(false);
    setConfirmDelete(false);
    setSelected(new Set());
    setEditing(false);
    await load();
  };

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.85} style={styles.backButton} onPress={() => router.replace('/')}>
          <Icon name="arrowLeft" size={d(24)} strokeWidth={2.6} />
        </TouchableOpacity>
        <Text style={styles.title}>Misiones</Text>
        <Text style={styles.count}>{missions.length} registrada{missions.length === 1 ? '' : 's'}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.headerButton, editing ? styles.headerButtonCancel : styles.headerButtonEdit]}
          onPress={toggleEditing}
        >
          <Text style={styles.headerButtonText}>{editing ? 'Cancelar' : 'Editar'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={C.red} style={{ marginTop: d(60) }} />
      ) : missions.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay misiones registradas</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, editing && { paddingBottom: d(90) }]}>
          {missions.map((m) => {
            const isSelected = selected.has(m.id_mision);
            const isExpanded = expandedId === m.id_mision;
            return (
              <View key={m.id_mision}>
                <View style={styles.rowLine}>
                  {editing && (
                    <Pressable hitSlop={8} onPress={() => toggleSelected(m.id_mision)} style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                      {isSelected && <Icon name="check" size={d(13)} color="#fff" strokeWidth={3.4} />}
                    </Pressable>
                  )}
                  <Pressable
                    style={[
                      styles.row,
                      editing && styles.rowEditing,
                      isSelected && styles.rowSelected,
                      isExpanded && styles.rowExpanded,
                    ]}
                    onPress={() => (editing ? toggleSelected(m.id_mision) : setExpandedId(isExpanded ? null : m.id_mision))}
                  >
                    <Text style={[styles.rowName, editing && !isSelected && { color: C.red }]} numberOfLines={1}>{m.nombre}</Text>
                    <Text style={[styles.rowMeta, isSelected && { color: C.text }]} numberOfLines={1}>{missionMeta(m)}</Text>
                    <View style={{ flex: 1 }} />
                    {!editing && <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={d(16)} color={C.textDim} strokeWidth={2.6} />}
                  </Pressable>
                </View>
                {isExpanded && !editing && <MissionDetail mission={m} />}
              </View>
            );
          })}
        </ScrollView>
      )}

      {editing && (
        <View style={styles.editBar}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={selected.size !== 1}
            style={[styles.editBarButton, styles.editDataButton, selected.size !== 1 && styles.disabled]}
            onPress={openEditForm}
          >
            <Text style={styles.editBarText}>Editar datos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={selected.size === 0}
            style={[styles.editBarButton, styles.deleteButton, selected.size === 0 && styles.disabled]}
            onPress={() => setConfirmDelete(true)}
          >
            <Text style={styles.editBarText}>Borrar</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal transparent animationType="fade" visible={!!editForm} onRequestClose={() => setEditForm(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Editar datos</Text>
            {editForm && (
              <>
                <Text style={styles.label}>NOMBRE</Text>
                <TextInput style={styles.input} value={editForm.nombre} onChangeText={(v) => setEditForm({ ...editForm, nombre: v })} />
                <Text style={styles.label}>OPERADOR</Text>
                <TextInput style={styles.input} value={editForm.operador} onChangeText={(v) => setEditForm({ ...editForm, operador: v })} />
                <Text style={styles.label}>UBICACIÓN</Text>
                <TextInput style={styles.input} value={editForm.ubicacion} onChangeText={(v) => setEditForm({ ...editForm, ubicacion: v })} />
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity activeOpacity={0.85} style={styles.modalSecondary} onPress={() => setEditForm(null)}>
                <Text style={styles.modalButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} style={styles.modalPrimary} disabled={busy} onPress={saveEditForm}>
                <Text style={styles.modalButtonText}>{busy ? 'Guardando…' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={confirmDelete} onRequestClose={() => setConfirmDelete(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Borrar {selected.size === 1 ? 'la misión' : `${selected.size} misiones`}?</Text>
            <Text style={styles.modalText}>Se eliminan también sus fotos, videos y línea de tiempo. No se puede deshacer.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity activeOpacity={0.85} style={styles.modalSecondary} onPress={() => setConfirmDelete(false)}>
                <Text style={styles.modalButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} style={styles.modalPrimary} disabled={busy} onPress={deleteSelected}>
                <Text style={styles.modalButtonText}>{busy ? 'Borrando…' : 'Borrar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerButton: { width: d(98), height: d(43), borderRadius: d(14), alignItems: 'center', justifyContent: 'center' },
  headerButtonEdit: { backgroundColor: C.redDark },
  headerButtonCancel: { backgroundColor: '#5A4D4D' },
  headerButtonText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14) },

  list: { flex: 1, marginTop: d(20) },
  listContent: { paddingLeft: d(41), paddingRight: d(35), paddingBottom: d(24), gap: d(10) },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: d(14) },
  row: {
    flex: 1,
    height: d(43),
    borderRadius: d(11),
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: d(14),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(12),
  },
  rowEditing: { borderColor: C.red },
  rowSelected: { backgroundColor: C.red, borderColor: C.red },
  rowExpanded: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  rowName: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14), maxWidth: d(260) },
  rowMeta: { color: C.textDim, fontFamily: HELV, fontSize: d(12), flexShrink: 1 },
  checkbox: {
    width: d(19),
    height: d(19),
    borderRadius: d(4),
    borderWidth: 2,
    borderColor: C.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: C.red },

  // Expanded mission
  detail: {
    backgroundColor: '#2F2828',
    borderBottomLeftRadius: d(11),
    borderBottomRightRadius: d(11),
    padding: d(14),
    gap: d(10),
  },
  detailInfo: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(11) },
  detailColumns: { flexDirection: 'row', gap: d(14), height: d(210) },
  timelineColumn: { width: '34%', borderRightWidth: 1, borderRightColor: C.divider, paddingRight: d(12) },
  mediaColumn: { flex: 1 },
  detailHeading: { color: C.text, fontFamily: VIGA, fontSize: d(14), marginBottom: d(6) },
  eventRow: { flexDirection: 'row', gap: d(10) },
  eventRail: { width: d(12), alignItems: 'center' },
  eventDot: { width: d(9), height: d(9), borderRadius: d(4.5), backgroundColor: C.textFaint, marginTop: d(4) },
  eventDotMedia: { backgroundColor: C.red },
  eventLine: { flex: 1, width: 1.5, backgroundColor: C.divider, marginVertical: d(2) },
  eventBody: { flex: 1, paddingBottom: d(10) },
  eventTime: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(10) },
  eventText: { color: C.text, fontFamily: HELV, fontSize: d(12), marginTop: d(1) },

  carousel: { flex: 1 },
  carouselFrame: {
    flex: 1,
    borderRadius: d(12),
    backgroundColor: '#1C1818',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselMedia: { width: '100%', height: '100%' },
  carouselArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: d(-16),
    width: d(32),
    height: d(32),
    borderRadius: d(16),
    backgroundColor: 'rgba(35,30,30,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: d(8) },
  carouselCaption: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(11) },
  carouselDots: { flexDirection: 'row', gap: d(5) },
  carouselDot: { width: d(7), height: d(7), borderRadius: d(3.5), backgroundColor: '#D9D9D9' },
  carouselDotActive: { width: d(20), backgroundColor: C.red },
  carouselEmpty: { flex: 1, borderRadius: d(12), backgroundColor: '#1C1818', alignItems: 'center', justifyContent: 'center' },

  empty: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(13), textAlign: 'center', marginTop: d(60) },
  emptySmall: { color: C.textFaint, fontFamily: HELV, fontSize: d(12) },

  // Edit mode bottom panel (page 4)
  editBar: {
    position: 'absolute',
    right: d(35),
    bottom: d(12),
    width: d(302),
    height: d(70),
    borderRadius: d(20),
    backgroundColor: '#6B5E5E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: d(15),
  },
  editBarButton: { height: d(40), borderRadius: d(12), alignItems: 'center', justifyContent: 'center' },
  editDataButton: { width: d(150), backgroundColor: '#8C7F7D' },
  deleteButton: { width: d(100), backgroundColor: C.red },
  editBarText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14) },
  disabled: { opacity: 0.45 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(40,34,34,0.6)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: d(380), borderRadius: d(22), backgroundColor: C.panel, padding: d(24) },
  modalTitle: { color: C.text, fontFamily: VIGA, fontSize: d(20), marginBottom: d(6) },
  modalText: { color: C.textDim, fontFamily: HELV, fontSize: d(13), lineHeight: d(18) },
  label: { color: C.textSoft, fontFamily: HELV, fontWeight: '700', fontSize: d(10.5), marginTop: d(8), marginBottom: d(6) },
  input: {
    height: d(37),
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: d(13),
    paddingHorizontal: d(14),
    color: C.text,
    fontFamily: HELV,
    fontWeight: '700',
    fontSize: d(13),
  },
  modalActions: { flexDirection: 'row', gap: d(14), marginTop: d(20) },
  modalSecondary: { width: d(120), height: d(46), borderRadius: d(13), backgroundColor: '#3D3434', alignItems: 'center', justifyContent: 'center' },
  modalPrimary: { flex: 1, height: d(46), borderRadius: d(13), backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14) },
});
