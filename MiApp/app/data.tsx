import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listServerMissions, renameMission, hideMission, ServerMission } from '../services/missions';
import Icon from '../components/Icons';
import { C, HELV, VIGA } from '../styles/theme';
import { d } from '../utils/scale';

// "Misiones" library: missions live in the backend's own database (not the
// robot), owned directly by whoever's Supabase session started them — the
// backend only ever returns the signed-in user's own, non-hidden missions,
// so there's no separate "claim"/ownership step needed here anymore.

function formatFecha(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export default function DataScreen() {
  const router = useRouter();
  const [missions, setMissions] = useState<ServerMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const list = await listServerMissions().catch((err) => {
      console.error('[listServerMissions] no se pudieron cargar las misiones', err);
      return [];
    });
    setMissions(list);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exitEdit = () => { setEditing(false); setSelected(new Set()); };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const rename = async () => {
    if (selected.size !== 1 || Platform.OS !== 'web') return;
    const id = [...selected][0];
    const current = missions.find((m) => m.mission_id === id)?.name ?? '';
    const next = window.prompt('Nuevo nombre para la misión:', current);
    if (!next || !next.trim()) return;
    await renameMission(id, next.trim()).catch(() => {});
    await load();
    exitEdit();
  };

  const remove = async () => {
    if (!selected.size) return;
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`¿Borrar ${selected.size} misión(es) de esta lista? (Los archivos siguen en el servidor, solo se ocultan acá)`)
      : true;
    if (!confirmed) return;
    await Promise.all([...selected].map((id) => hideMission(id, true).catch(() => {})));
    await load();
    exitEdit();
  };

  return (
    <View style={styles.window}>
      <View style={styles.header}>
        <BackButton router={router} editing={editing} onExitEdit={exitEdit} />
        <Text style={styles.title}>Misiones</Text>
        <Text style={styles.count}>{missions.length} registrada{missions.length === 1 ? '' : 's'}</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          style={[styles.editBtn, editing && styles.editBtnCancel]}
          onPress={() => (editing ? exitEdit() : setEditing(true))}
        >
          <Text style={[styles.editBtnText, editing && styles.editBtnCancelText]}>{editing ? 'Cancelar' : 'Editar'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={C.red} style={{ marginTop: d(60) }} />
      ) : missions.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay misiones registradas</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {missions.map((m) => {
            const isSelected = selected.has(m.mission_id);
            const name = m.name;
            return (
              <Pressable
                key={m.mission_id}
                style={[styles.row, editing && styles.rowEditing, isSelected && styles.rowSelected]}
                onPress={() => (editing
                  ? toggleSelect(m.mission_id)
                  : router.push({ pathname: '/mision-detalle', params: { id: m.mission_id } }))}
              >
                {editing && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                    {isSelected && <Icon name="check" size={d(13)} color={C.text} strokeWidth={3} />}
                  </View>
                )}
                <Text style={[styles.rowName, isSelected && styles.rowTextOn]} numberOfLines={1}>{name}</Text>
                <Text style={[styles.rowMeta, isSelected && styles.rowTextOn]} numberOfLines={1}>
                  {formatFecha(m.started_at)} {m.location ? `| ${m.location}` : `· ${m.robot_id}`}
                </Text>
                <View style={{ flex: 1 }} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {editing && selected.size > 0 && (
        <View style={styles.actionBar}>
          <Pressable style={styles.actionBtnMuted} onPress={rename} disabled={selected.size !== 1}>
            <Text style={[styles.actionBtnMutedText, selected.size !== 1 && { opacity: 0.4 }]}>Editar datos</Text>
          </Pressable>
          <Pressable style={styles.actionBtnRed} onPress={remove}>
            <Text style={styles.actionBtnRedText}>Borrar</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Small helper so the back button hides (not just disables) while editing,
// matching the mockup: "Cancelar" replaces the whole left/right header action.
function BackButton({ router, editing, onExitEdit }: {
  router: ReturnType<typeof useRouter>;
  editing: boolean;
  onExitEdit: () => void;
}) {
  return (
    <Pressable
      style={styles.backButton}
      onPress={() => (editing ? onExitEdit() : router.replace('/'))}
    >
      <Icon name="arrowLeft" size={d(24)} strokeWidth={2.6} color={C.text} />
    </Pressable>
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

  editBtn: { height: d(38), paddingHorizontal: d(18), borderRadius: d(19), backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  editBtnCancel: { backgroundColor: C.muted },
  editBtnText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },
  editBtnCancelText: { color: C.textSoft },

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
  rowEditing: { borderColor: C.red },
  rowSelected: { backgroundColor: C.red, borderColor: C.red },
  rowName: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14), maxWidth: d(220) },
  rowMeta: { color: C.textDim, fontFamily: HELV, fontSize: d(12), flexShrink: 1 },
  rowTextOn: { color: C.text },

  checkbox: {
    width: d(20), height: d(20), borderRadius: d(5), borderWidth: 1.5, borderColor: C.red,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: C.red },

  actionBar: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: d(10),
    paddingHorizontal: d(35), paddingVertical: d(14),
  },
  actionBtnMuted: { height: d(40), paddingHorizontal: d(18), borderRadius: d(10), backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  actionBtnMutedText: { color: C.textSoft, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },
  actionBtnRed: { height: d(40), paddingHorizontal: d(22), borderRadius: d(10), backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  actionBtnRedText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(12.5) },

  empty: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(13), textAlign: 'center', marginTop: d(60) },
});
