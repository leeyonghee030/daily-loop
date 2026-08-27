import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  fetchDeletedPresets,
  hardDeletePreset,
  restorePreset,
  type RoutinePreset,
} from '@/lib/presets';
import {
  archiveRoutines,
  fetchDeletedRoutines,
  restoreRoutine,
  restoreRoutinesByPreset,
  SLOT_LABELS,
  type Routine,
} from '@/lib/routines';

function timeLabel(routine: Routine): string {
  if (routine.is_instant && routine.scheduled_time_start) {
    return routine.scheduled_time_start.slice(0, 5);
  }
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '시간 미지정';
}

function daysUntilPurge(deletedAt: string): number {
  const purgeDate = new Date(deletedAt);
  purgeDate.setDate(purgeDate.getDate() + 14);
  const diffMs = purgeDate.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export default function RoutineTrashScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [deletedRoutines, setDeletedRoutines] = useState<Routine[]>([]);
  const [deletedPresets, setDeletedPresets] = useState<RoutinePreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [selectedRoutineIds, setSelectedRoutineIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const [routines, presets] = await Promise.all([fetchDeletedRoutines(userId), fetchDeletedPresets(userId)]);
      setDeletedRoutines(routines);
      setDeletedPresets(presets);
    } catch {
      setErrorMessage('불러오지 못했어요.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const deletedPresetIds = useMemo(() => new Set(deletedPresets.map((p) => p.id)), [deletedPresets]);

  // 모음집 자체가 삭제되면서 같이 삭제된 루틴은 개별 항목이 아니라 모음집 단위로 묶어서 보여준다
  const groupedByPreset = useMemo(() => {
    const map = new Map<string, Routine[]>();
    for (const routine of deletedRoutines) {
      if (routine.preset_id && deletedPresetIds.has(routine.preset_id)) {
        if (!map.has(routine.preset_id)) map.set(routine.preset_id, []);
        map.get(routine.preset_id)!.push(routine);
      }
    }
    return map;
  }, [deletedRoutines, deletedPresetIds]);

  const individualRoutines = deletedRoutines.filter((r) => !(r.preset_id && deletedPresetIds.has(r.preset_id)));
  const totalSelectableCount = deletedPresets.length + individualRoutines.length;
  const totalSelectedCount = selectedPresetIds.size + selectedRoutineIds.size;

  async function handleRestorePreset(preset: RoutinePreset) {
    setBusyKey(preset.id);
    setErrorMessage(null);
    try {
      await restorePreset(preset.id);
      await restoreRoutinesByPreset(preset.id);
      setDeletedPresets((prev) => prev.filter((p) => p.id !== preset.id));
      setDeletedRoutines((prev) => prev.filter((r) => r.preset_id !== preset.id));
    } catch {
      setErrorMessage('복구에 실패했어요.');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRestoreRoutine(routine: Routine) {
    setBusyKey(routine.id);
    setErrorMessage(null);
    try {
      await restoreRoutine(routine.id);
      setDeletedRoutines((prev) => prev.filter((r) => r.id !== routine.id));
    } catch {
      setErrorMessage('복구에 실패했어요.');
    } finally {
      setBusyKey(null);
    }
  }

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedPresetIds(new Set());
    setSelectedRoutineIds(new Set());
  }

  function togglePresetSelected(id: string) {
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRoutineSelected(id: string) {
    setSelectedRoutineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (totalSelectedCount === totalSelectableCount) {
      setSelectedPresetIds(new Set());
      setSelectedRoutineIds(new Set());
    } else {
      setSelectedPresetIds(new Set(deletedPresets.map((p) => p.id)));
      setSelectedRoutineIds(new Set(individualRoutines.map((r) => r.id)));
    }
  }

  // 모음집(템플릿)은 완전삭제(완료기록이 안 달려있어서 안전) — 루틴은 완료기록 보존을 위해
  // 절대 완전삭제하지 않고, "루틴 복구" 목록에서만 치운다(archived_at). 그래서 확인 문구도
  // "되돌릴 수 없어요" 같은 무서운 경고 없이, 기록은 안전하다는 걸 분명히 알려준다
  function handleDeleteSelected() {
    if (totalSelectedCount === 0) return;
    const presetIds = Array.from(selectedPresetIds);
    const routineIds = Array.from(selectedRoutineIds);
    const parts: string[] = [];
    if (presetIds.length > 0) parts.push(`모음집 ${presetIds.length}개는 완전히 삭제돼요(연결된 루틴·기록은 안 지워져요)`);
    if (routineIds.length > 0) parts.push(`루틴 ${routineIds.length}개는 이 목록에서만 정리돼요(완료기록은 계속 안전하게 보관돼요)`);

    Alert.alert('정리할까요?', parts.join('. ') + '.', [
      { text: '취소', style: 'cancel' },
      {
        text: '정리하기',
        onPress: async () => {
          setErrorMessage(null);
          try {
            await Promise.all([
              ...presetIds.map((id) => hardDeletePreset(id)),
              routineIds.length > 0 ? archiveRoutines(routineIds) : Promise.resolve(),
            ]);
            setSelectedPresetIds(new Set());
            setSelectedRoutineIds(new Set());
            setSelectMode(false);
            await load();
          } catch {
            setErrorMessage('정리에 실패했어요.');
          }
        },
      },
    ]);
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const isEmpty = deletedPresets.length === 0 && individualRoutines.length === 0;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbarRow}>
        {selectMode ? (
          <>
            <Text style={styles.selectedCountText}>{totalSelectedCount}개 선택됨</Text>
            <Pressable style={styles.toolbarButton} onPress={toggleSelectAll}>
              <Text style={styles.toolbarButtonText}>
                {totalSelectedCount === totalSelectableCount ? '전체 해제' : '전체 선택'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.toolbarButton}
              disabled={totalSelectedCount === 0}
              onPress={handleDeleteSelected}>
              <Text style={styles.toolbarButtonText}>정리</Text>
            </Pressable>
            <Pressable style={styles.toolbarButton} onPress={toggleSelectMode}>
              <Text style={styles.toolbarButtonText}>취소</Text>
            </Pressable>
          </>
        ) : (
          !isEmpty && (
            <Pressable style={styles.toolbarButton} onPress={toggleSelectMode}>
              <Text style={styles.toolbarButtonText}>선택 정리</Text>
            </Pressable>
          )
        )}
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.desc}>
          삭제된 루틴은 여기서 언제든 복구할 수 있어요. 완료 기록도 계속 안전하게 보관되니 걱정 마세요.{'\n\n'}
          모음집(루틴 묶음)은 2주 안에 복구하지 않으면 자동으로 삭제돼요. 2주를 기다리지 않고 바로 삭제하고
          싶다면 "선택 정리"를 눌러주세요(연결된 루틴은 지워지지 않아요).
        </Text>

        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

        {isEmpty && <Text style={styles.emptyText}>삭제된 항목이 없어요.</Text>}

        {deletedPresets.map((preset) => {
          const routines = groupedByPreset.get(preset.id) ?? [];
          const isSelected = selectedPresetIds.has(preset.id);
          return (
            <Pressable
              key={preset.id}
              style={[styles.presetCard, selectMode && isSelected && styles.cardSelected]}
              disabled={!selectMode}
              onPress={() => togglePresetSelected(preset.id)}>
              <View style={styles.cardHeaderRow}>
                {selectMode && (
                  <View style={[styles.checkboxBox, isSelected && styles.checkboxBoxChecked]}>
                    {isSelected && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                )}
                <View style={styles.cardHeaderText}>
                  <Text style={styles.presetTitle}>📦 {preset.name}</Text>
                  <Text style={styles.presetMeta}>
                    루틴 {routines.length}개 · {daysUntilPurge(preset.deleted_at!)}일 후 완전 삭제
                  </Text>
                </View>
              </View>
              {routines.map((routine) => (
                <Text key={routine.id} style={styles.presetRoutineTitle} numberOfLines={1}>
                  · {routine.title}
                </Text>
              ))}
              {!selectMode && (
                <Pressable
                  style={styles.restoreButton}
                  disabled={busyKey === preset.id}
                  onPress={() => handleRestorePreset(preset)}>
                  <Text style={styles.restoreButtonText}>모음집 복구</Text>
                </Pressable>
              )}
            </Pressable>
          );
        })}

        {individualRoutines.map((routine) => {
          const isSelected = selectedRoutineIds.has(routine.id);
          return (
            <Pressable
              key={routine.id}
              style={[styles.row, selectMode && isSelected && styles.cardSelected]}
              disabled={!selectMode}
              onPress={() => toggleRoutineSelected(routine.id)}>
              {selectMode && (
                <View style={[styles.checkboxBox, isSelected && styles.checkboxBoxChecked]}>
                  {isSelected && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {routine.title}
                  {routine.preset?.name ? ` · ${routine.preset.name}` : ''}
                </Text>
                <Text style={styles.rowMeta}>{timeLabel(routine)}</Text>
              </View>
              {!selectMode && (
                <Pressable
                  style={styles.restoreButtonSmall}
                  disabled={busyKey === routine.id}
                  onPress={() => handleRestoreRoutine(routine)}>
                  <Text style={styles.restoreButtonSmallText}>복구</Text>
                </Pressable>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  selectedCountText: {
    fontSize: 12,
    opacity: 0.6,
    marginRight: 'auto',
  },
  toolbarButton: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  toolbarButtonText: {
    fontSize: 13,
    color: '#7C5CFC',
    fontWeight: '600',
  },
  desc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 16,
    lineHeight: 18,
  },
  error: {
    color: '#FF6B6B',
    marginBottom: 12,
  },
  emptyText: {
    opacity: 0.4,
    textAlign: 'center',
    marginTop: 40,
  },
  presetCard: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardSelected: {
    borderColor: '#7C5CFC',
    backgroundColor: 'rgba(124, 92, 252, 0.06)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardHeaderText: {
    flex: 1,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#7C5CFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: '#7C5CFC',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  presetTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  presetMeta: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  presetRoutineTitle: {
    fontSize: 13,
    opacity: 0.75,
    marginTop: 8,
    marginBottom: 2,
  },
  restoreButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  restoreButtonText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
  },
  rowMeta: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  restoreButtonSmall: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  restoreButtonSmallText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
});
