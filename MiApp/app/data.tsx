import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Pressable,
  StyleSheet, ActivityIndicator, Image, TextInput, Platform, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { getMisiones, eliminarMision, renombrarMision, MisionResumen, MisionContenido, MisionGaleriaItem } from '../services/api';
import { AnalysisResult } from '../services/api';
import { getMissionVideoUrl } from '../services/misionMedia';
import { d } from '../utils/scale';

const RED = '#E83D3D';
const BG = '#292222';
const PANEL = '#453A3A';
const MONO = Platform.OS === 'web' ? '"JetBrains Mono", monospace' : 'monospace';

function severityColor(s: number) {
  if (s <= 3) return '#22c55e';
  if (s <= 6) return '#f59e0b';
  if (s <= 8) return '#f97316';
  return '#f23b3f';
}

function EdificioCard({ edificio }: { edificio: { nombre: string; previewUri: string; analysis: AnalysisResult } }) {
  return (
    <View style={styles.edificioCard}>
      <View style={styles.edificioRow}>
        {edificio.previewUri ? (
          <Image source={{ uri: edificio.previewUri }} style={styles.edificioThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.edificioThumb, { justifyContent: 'center', alignItems: 'center' }]}>
            <MaterialIcons name="photo" size={24} color="#555" />
          </View>
        )}
        <View style={styles.edificioInfo}>
          <Text style={styles.edificioNombre}>{edificio.nombre}</Text>
          <View style={[styles.severityBadge, { backgroundColor: severityColor(edificio.analysis.nivel_severidad_general) }]}>
            <Text style={styles.severityText}>{edificio.analysis.nivel_severidad_general}/10 · {edificio.analysis.grado_general}</Text>
          </View>
          <Text style={styles.edificioResumen} numberOfLines={2}>{edificio.analysis.resumen}</Text>
        </View>
      </View>
    </View>
  );
}

function contenidoDeMision(descripcion: string | null): MisionContenido {
  if (!descripcion) return { edificios: [], galeria: [] };
  try {
    const parsed = JSON.parse(descripcion);
    // Las misiones anteriores guardaban directamente el array de edificios.
    if (Array.isArray(parsed)) return { edificios: parsed, galeria: [] };
    return {
      edificios: Array.isArray(parsed?.edificios) ? parsed.edificios : [],
      galeria: Array.isArray(parsed?.galeria) ? parsed.galeria : [],
    };
  } catch {
    return { edificios: [], galeria: [] };
  }
}

function formatFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function GaleriaMision({ items }: { items: MisionGaleriaItem[] }) {
  const [videos, setVideos] = useState<Record<string, string>>({});

  useEffect(() => {
    let activo = true;
    const urls: string[] = [];
    Promise.all(items.filter((item) => item.tipo === 'video' && item.videoId).map(async (item) => {
      const url = await getMissionVideoUrl(item.videoId!);
      if (url) urls.push(url);
      return [item.id, url] as const;
    })).then((entries) => {
      if (activo) setVideos(Object.fromEntries(entries.filter(([, url]) => !!url)) as Record<string, string>);
    }).catch(() => {});
    return () => {
      activo = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [items]);

  if (!items.length) return <Text style={styles.sinDatos}>Sin capturas ni grabaciones</Text>;
  return (
    <View style={styles.galeriaGrid}>
      {items.map((item) => (
        <View key={item.id} style={styles.mediaCard}>
          {item.tipo === 'captura' && item.uri ? (
            <Image source={{ uri: item.uri }} style={styles.mediaPreview} resizeMode="cover" />
          ) : videos[item.id] ? (
            React.createElement('video', { src: videos[item.id], controls: true, style: { width: '100%', height: 116, backgroundColor: '#000', borderRadius: 3 } })
          ) : (
            <View style={[styles.mediaPreview, styles.mediaLoading]}><MaterialIcons name="videocam" size={26} color="#6b5555" /></View>
          )}
          <Text style={styles.mediaLabel}>{item.tipo === 'captura' ? 'CAPTURA' : `VIDEO${item.duracionMs ? ` · ${Math.max(1, Math.round(item.duracionMs / 1000))}s` : ''}`}</Text>
        </View>
      ))}
    </View>
  );
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

function MisionRow({ mision, onOpen, onMore, onRename }: {
  mision: MisionResumen;
  onOpen: () => void;
  onMore: () => void;
  onRename: (nombre: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editando, setEditando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState(mision.nombre);

  const confirmarRename = () => {
    const nombre = nuevoNombre.trim();
    if (nombre && nombre !== mision.nombre) onRename(nombre);
    else setNuevoNombre(mision.nombre);
    setEditando(false);
  };

  return (
    <Pressable
      style={styles.row}
      onPress={editando ? undefined : onOpen}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <View style={styles.rowTitle}>
        {editando ? (
          <TextInput
            value={nuevoNombre}
            onChangeText={setNuevoNombre}
            onBlur={confirmarRename}
            onSubmitEditing={confirmarRename}
            autoFocus
            style={[styles.rowText, styles.renameInput]}
          />
        ) : (
          <Text style={styles.rowText} numberOfLines={1}>{mision.nombre.toUpperCase()}</Text>
        )}
        {/* Web shows the pencil on hover; touch devices always show it. */}
        {!editando && (hovered || Platform.OS !== 'web') && (
          <TouchableOpacity onPress={() => setEditando(true)} hitSlop={8}>
            <Text style={styles.pencil}>✎</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity onPress={onMore} hitSlop={10} style={styles.moreButton}>
        <MoreDots />
      </TouchableOpacity>
    </Pressable>
  );
}

function MisionPreviewCard({ mision, onClose, onOpen, onRename, onDelete }: {
  mision: MisionResumen;
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { edificios, galeria } = contenidoDeMision(mision.descripcion);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.rowText} numberOfLines={1}>{mision.nombre.toUpperCase()}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.cardMore}>
          <MoreDots />
        </TouchableOpacity>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardMeta}>{formatFecha(mision.created_at)}</Text>
        <Text style={styles.cardMeta}>{edificios.length} edificio(s)</Text>
        <Text style={styles.cardMeta}>{galeria.length} captura(s)/video(s)</Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity onPress={onOpen}><Text style={styles.cardAction}>ABRIR</Text></TouchableOpacity>
        <TouchableOpacity onPress={onRename}><Text style={styles.cardAction}>RENOMBRAR</Text></TouchableOpacity>
        <TouchableOpacity onPress={onDelete}><Text style={styles.cardAction}>ELIMINAR</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function MisionDetalle({ mision, onBack }: { mision: MisionResumen; onBack: () => void }) {
  const [tab, setTab] = useState<'edificios' | 'galeria'>('edificios');
  const { edificios, galeria } = contenidoDeMision(mision.descripcion);

  return (
    <View style={styles.window}>
      <View style={styles.topBar}>
        <TopButton label="BACK" onPress={onBack} />
      </View>
      <Text style={styles.detailTitle}>{mision.nombre.toUpperCase()}</Text>

      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        {tab === 'edificios' ? (
          edificios.length === 0
            ? <Text style={styles.sinDatos}>Sin edificios analizados</Text>
            : edificios.map((e: any, i: number) => <EdificioCard key={i} edificio={e} />)
        ) : (
          <GaleriaMision items={galeria} />
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        {(['edificios', 'galeria'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={styles.bottomBarItem}>
            <Text style={[styles.bottomBarText, tab === t && styles.bottomBarTextActive]}>
              {t === 'edificios' ? 'EDIFICIOS' : 'GALERÍA'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function confirmar(mensaje: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(mensaje));
  return new Promise((resolve) => {
    Alert.alert('Confirmar', mensaje, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function DataScreen() {
  const router = useRouter();
  const [misiones, setMisiones] = useState<MisionResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');

  const cargarMisiones = useCallback(async () => {
    setCargando(true);
    try { setMisiones(await getMisiones()); }
    catch { setMisiones([]); }
    finally { setCargando(false); }
  }, []);

  useFocusEffect(useCallback(() => { cargarMisiones(); }, [cargarMisiones]));

  const handleDelete = async (id: number) => {
    if (!(await confirmar('¿Eliminar esta misión?'))) return;
    await eliminarMision(id);
    setMisiones(prev => prev.filter(m => m.id_mision !== id));
    setPreviewId(null);
  };

  const handleRename = async (id: number, nombre: string) => {
    await renombrarMision(id, nombre);
    setMisiones(prev => prev.map(m => m.id_mision === id ? { ...m, nombre } : m));
  };

  const detalle = misiones.find((m) => m.id_mision === detalleId);
  if (detalle) return <MisionDetalle mision={detalle} onBack={() => setDetalleId(null)} />;

  const preview = misiones.find((m) => m.id_mision === previewId);

  return (
    <View style={styles.window}>
      <View style={styles.topBar}>
        <TopButton label="HOME" onPress={() => router.replace('/')} />
      </View>

      {cargando ? (
        <ActivityIndicator color={RED} style={{ marginTop: d(112) }} />
      ) : preview ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewId(null)}>
          <Pressable style={styles.cardPosition}>
            {renameId === preview.id_mision ? (
              <View style={styles.card}>
                <TextInput
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  style={[styles.rowText, styles.renameInput]}
                  onSubmitEditing={() => { handleRename(preview.id_mision, renameText.trim() || preview.nombre); setRenameId(null); }}
                  onBlur={() => { handleRename(preview.id_mision, renameText.trim() || preview.nombre); setRenameId(null); }}
                />
              </View>
            ) : (
              <MisionPreviewCard
                mision={preview}
                onClose={() => setPreviewId(null)}
                onOpen={() => { setPreviewId(null); setDetalleId(preview.id_mision); }}
                onRename={() => { setRenameText(preview.nombre); setRenameId(preview.id_mision); }}
                onDelete={() => handleDelete(preview.id_mision)}
              />
            )}
          </Pressable>
        </Pressable>
      ) : misiones.length === 0 ? (
        <Text style={[styles.sinDatos, { marginTop: d(112) }]}>No hay misiones guardadas</Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {misiones.map((m) => (
            <MisionRow
              key={m.id_mision}
              mision={m}
              onOpen={() => setDetalleId(m.id_mision)}
              onMore={() => setPreviewId(m.id_mision)}
              onRename={(nombre) => handleRename(m.id_mision, nombre)}
            />
          ))}
        </ScrollView>
      )}
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
  rowText: { color: RED, fontFamily: MONO, fontSize: d(18), letterSpacing: 1 },
  pencil: { color: RED, fontSize: d(17) },
  renameInput: { minWidth: d(220), borderBottomWidth: 1, borderColor: RED, paddingVertical: 2 },
  moreButton: { paddingVertical: d(8), paddingLeft: d(8) },

  dots: { flexDirection: 'row', gap: d(3) },
  dot: { width: d(3), height: d(3), borderRadius: d(1.5), backgroundColor: RED },

  cardPosition: { position: 'absolute', top: d(113), left: d(213) },
  card: {
    width: d(240),
    height: d(224),
    borderWidth: 2,
    borderColor: RED,
    borderRadius: 5,
    backgroundColor: PANEL,
    paddingHorizontal: d(20),
    paddingTop: d(16),
    paddingBottom: d(14),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMore: { marginTop: d(-6), marginRight: d(-10), padding: d(4) },
  cardBody: { flex: 1, marginTop: d(14), gap: d(4) },
  cardMeta: { color: '#9a8585', fontFamily: MONO, fontSize: d(11) },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between' },
  cardAction: { color: RED, fontFamily: MONO, fontSize: d(10), letterSpacing: 0.5 },

  detailTitle: {
    marginTop: d(66),
    textAlign: 'center',
    color: RED,
    fontFamily: MONO,
    fontSize: d(18),
    letterSpacing: 1,
  },
  detailScroll: { flex: 1, marginTop: d(20), marginBottom: d(8) },
  detailContent: { paddingHorizontal: d(40), gap: d(10) },
  bottomBar: {
    alignSelf: 'center',
    width: d(385),
    height: d(48),
    marginBottom: d(13),
    borderRadius: d(24),
    backgroundColor: '#433A3A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: d(40),
  },
  bottomBarItem: { paddingVertical: d(8) },
  bottomBarText: { color: '#8b7474', fontFamily: MONO, fontSize: d(12), letterSpacing: 1 },
  bottomBarTextActive: { color: RED },

  edificioCard: { borderWidth: 1, borderColor: '#433838', borderRadius: 4, padding: 10 },
  edificioRow: { flexDirection: 'row' },
  edificioThumb: { width: 72, height: 54, borderRadius: 3, backgroundColor: '#2e2626', marginRight: 10 },
  edificioInfo: { flex: 1 },
  edificioNombre: { color: '#f6e7e7', fontFamily: MONO, fontWeight: '700', fontSize: 12, marginBottom: 4 },
  severityBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginBottom: 4 },
  severityText: { color: '#fff', fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  edificioResumen: { color: '#8b7474', fontFamily: MONO, fontSize: 11, lineHeight: 15 },

  galeriaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaCard: { width: 168, borderWidth: 1, borderColor: '#433838', borderRadius: 4, padding: 5, backgroundColor: '#211919' },
  mediaPreview: { width: '100%', height: 116, borderRadius: 3, backgroundColor: '#111' },
  mediaLoading: { alignItems: 'center', justifyContent: 'center' },
  mediaLabel: { color: '#9a8a8a', fontFamily: MONO, fontSize: 10, marginTop: 5 },

  sinDatos: { color: '#6b5555', fontFamily: MONO, fontSize: 13, textAlign: 'center', marginTop: 20 },
});
