import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Image, TextInput,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { getMisiones, eliminarMision, renombrarMision, MisionResumen, MisionContenido, MisionGaleriaItem } from '../services/api';
import { AnalysisResult } from '../services/api';
import { getMissionVideoUrl } from '../services/misionMedia';

const RED = '#f23b3f';
const BG = '#292222';
const PANEL = '#383535';

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

  if (!items.length) return <Text style={styles.sinGaleria}>Sin capturas ni grabaciones</Text>;
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

function MisionCard({ mision, onDelete, onRename }: {
  mision: MisionResumen;
  onDelete: (id: number) => void;
  onRename: (id: number, nombre: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState(mision.nombre);

  const { edificios, galeria } = contenidoDeMision(mision.descripcion);

  const fecha = new Date(mision.created_at).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const confirmarRename = () => {
    const nombre = nuevoNombre.trim();
    if (nombre && nombre !== mision.nombre) onRename(mision.id_mision, nombre);
    setEditando(false);
  };

  return (
    <View style={styles.acordeon}>
      <View style={styles.acordeonHeader}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => setAbierto(v => !v)} activeOpacity={0.8}>
          {editando ? (
            <TextInput
              value={nuevoNombre}
              onChangeText={setNuevoNombre}
              onBlur={confirmarRename}
              onSubmitEditing={confirmarRename}
              autoFocus
              style={styles.renameInput}
            />
          ) : (
            <Text style={styles.acordeonTitulo} numberOfLines={1}>{nuevoNombre}  ·  {fecha}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.acordeonActions}>
          <TouchableOpacity onPress={() => setEditando(v => !v)} style={styles.iconBtn}>
            <MaterialIcons name="edit" size={18} color="#8b7474" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(mision.id_mision)} style={styles.iconBtn}>
            <MaterialIcons name="delete-outline" size={18} color="#8b7474" />
          </TouchableOpacity>
          <MaterialIcons name={abierto ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={22} color={RED} />
        </View>
      </View>

      {abierto && (
        <View style={styles.acordeonBody}>
          {edificios.length === 0 ? (
            <Text style={styles.sinDatos}>Sin edificios analizados</Text>
          ) : (
            edificios.map((e: any, i: number) => (
              <EdificioCard key={i} edificio={e} />
            ))
          )}
          <Text style={styles.seccionTitulo}>GALERÍA DE MISIÓN</Text>
          <GaleriaMision items={galeria} />
        </View>
      )}
    </View>
  );
}


export default function DataScreen() {
  const router = useRouter();
  const [misiones, setMisiones] = useState<MisionResumen[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargarMisiones = useCallback(async () => {
    setCargando(true);
    try { setMisiones(await getMisiones()); }
    catch { setMisiones([]); }
    finally { setCargando(false); }
  }, []);

  useFocusEffect(useCallback(() => { cargarMisiones(); }, [cargarMisiones]));

  const handleDelete = async (id: number) => {
    await eliminarMision(id);
    setMisiones(prev => prev.filter(m => m.id_mision !== id));
  };

  const handleRename = async (id: number, nombre: string) => {
    await renombrarMision(id, nombre);
    setMisiones(prev => prev.map(m => m.id_mision === id ? { ...m, nombre } : m));
  };

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.btnBack} onPress={() => router.replace('/')} activeOpacity={0.8}>
          <Text style={styles.btnBackText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>MISIONES</Text>
        <View style={{ width: 70 }} />
      </View>

      {cargando ? (
        <ActivityIndicator color={RED} style={{ marginTop: 40 }} />
      ) : misiones.length === 0 ? (
        <Text style={styles.sinDatos}>No hay misiones guardadas</Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {misiones.map(m => (
            <MisionCard key={m.id_mision} mision={m} onDelete={handleDelete} onRename={handleRename} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 28, paddingBottom: 16,
  },
  btnBack: { width: 70, height: 32, borderWidth: 1, borderColor: RED, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  btnBackText: { color: RED, fontFamily: 'monospace', fontSize: 13 },
  titulo: { color: RED, fontFamily: 'monospace', fontSize: 20, letterSpacing: 1 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  acordeon: { borderWidth: 1, borderColor: RED, borderRadius: 4, overflow: 'hidden' },
  acordeonHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: PANEL },
  acordeonTitulo: { color: RED, fontFamily: 'monospace', fontSize: 13, flex: 1 },
  acordeonActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 4 },
  acordeonBody: { padding: 12, backgroundColor: BG, gap: 10 },

  renameInput: {
    color: RED, fontFamily: 'monospace', fontSize: 13,
    borderBottomWidth: 1, borderColor: RED, paddingVertical: 2,
  },

  edificioCard: { borderWidth: 1, borderColor: '#433838', borderRadius: 4, padding: 10 },
  edificioRow: { flexDirection: 'row' },
  edificioThumb: { width: 72, height: 54, borderRadius: 3, backgroundColor: '#2e2626', marginRight: 10 },
  edificioInfo: { flex: 1 },
  edificioNombre: { color: '#f6e7e7', fontFamily: 'monospace', fontWeight: '700', fontSize: 12, marginBottom: 4 },
  severityBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginBottom: 4 },
  severityText: { color: '#fff', fontFamily: 'monospace', fontSize: 11, fontWeight: '700' },
  edificioResumen: { color: '#8b7474', fontFamily: 'monospace', fontSize: 11, lineHeight: 15 },

  seccionTitulo: { color: RED, fontFamily: 'monospace', fontSize: 12, marginTop: 8, letterSpacing: 0.5 },
  sinGaleria: { color: '#6b5555', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', marginVertical: 8 },
  galeriaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaCard: { width: 168, borderWidth: 1, borderColor: '#433838', borderRadius: 4, padding: 5, backgroundColor: '#211919' },
  mediaPreview: { width: '100%', height: 116, borderRadius: 3, backgroundColor: '#111' },
  mediaLoading: { alignItems: 'center', justifyContent: 'center' },
  mediaLabel: { color: '#9a8a8a', fontFamily: 'monospace', fontSize: 10, marginTop: 5 },

  sinDatos: { color: '#6b5555', fontFamily: 'monospace', fontSize: 13, textAlign: 'center', marginTop: 40 },
});
