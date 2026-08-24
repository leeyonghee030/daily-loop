import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet } from 'react-native';
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { fetchPresets, type RoutinePreset } from '@/lib/presets';
import {
  fetchAllRoutines,
  softDeleteRoutine,
  softDeleteRoutines,
  updateSortOrder,
  SLOT_LABELS,
  type RepeatType,
  type Routine,
} from '@/lib/routines';

type FilterValue = RepeatType | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'daily', label: '매일' },
  { value: 'weekday', label: '평일' },
  { value: 'weekend', label: '주말' },
  { value: 'custom', label: '특정 요일' },
  { value: 'once', label: '1회성' },
];

const REPEAT_LABELS: Record<RepeatType, string> = {
  daily: '매일',
  weekday: '평일',
  weekend: '주말',
  custom: '특정 요일',
  once: '1회성',
};

function timeLabel(routine: Routine): string {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '시간 미지정';
}

function metaLabel(routine: Routine): string {
  const parts = [REPEAT_LABELS[routine.repeat_type], timeLabel(routine)];
  if (routine.preset?.name) parts.push(routine.preset.name);
  if (routine.is_paused) parts.push('일시정지');
  return parts.join(' · ');
}

function RoutineRow({
  routine,
  selectMode,
  isSelected,
  onEdit,
  onToggleSelect,
  onDelete,
}: {
  routine: Routine;
  selectMode: boolean;
  isSelected: boolean;
  onEdit: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  // react-native-reorderable-list가 제공하는 훅 — 이 핸들을 길게 누르면 그 항목의 드래그가 시작됨
  const drag = useReorderableDrag();

  return (
    <View style={styles.row}>
      {selectMode ? (
        <Pressable style={styles.checkbox} onPress={onToggleSelect} hitSlop={8}>
          <View style={[styles.checkboxBox, isSelected && styles.checkboxBoxChecked]}>
            {isSelected && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
        </Pressable>
      ) : (
        <Pressable onLongPress={drag} delayLongPress={150} style={styles.dragHandle} hitSlop={8}>
          <Text style={styles.dragHandleText}>≡</Text>
        </Pressable>
      )}
      <Pressable style={styles.rowMain} onPress={selectMode ? onToggleSelect : onEdit}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {routine.title}
          {routine.is_required ? ' · 필수' : ''}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {metaLabel(routine)}
        </Text>
      </Pressable>
      {!selectMode && (
        <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
          <Text style={styles.deleteButtonText}>삭제</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function MyRoutinesScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [presets, setPresets] = useState<RoutinePreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<'repeat' | 'preset'>('repeat');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [presetFilter, setPresetFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const [data, presetList] = await Promise.all([fetchAllRoutines(userId), fetchPresets(userId)]);
      setRoutines(data);
      setPresets(presetList);
    } catch {
      setErrorMessage('루틴을 불러오지 못했어요.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = routines.filter((r) => {
    if (groupMode === 'repeat') {
      return filter === 'all' || r.repeat_type === filter;
    }
    // 모음집 탭에서는 특정 모음집을 고르기 전까지는 아무것도 안 보여준다 —
    // "반복 주기" 탭에서 보이던 목록이 그대로 남아있으면 헷갈려서
    return presetFilter !== null && r.preset_id === presetFilter;
  });

  function switchGroupMode(mode: 'repeat' | 'preset') {
    setGroupMode(mode);
    setFilter('all');
    setPresetFilter(null);
  }

  // 필터된 부분만 새 순서로 바뀌고, 필터에 안 걸린 나머지 루틴은 원래 위치 그대로 유지
  function applyNewOrder(newFilteredOrder: Routine[]) {
    const filteredIds = new Set(filtered.map((r) => r.id));
    let cursor = 0;
    const merged = routines.map((r) => (filteredIds.has(r.id) ? newFilteredOrder[cursor++] : r));
    setRoutines(merged);
    updateSortOrder(merged.map((r) => r.id)).catch(() => load());
  }

  function handleReorder({ from, to }: ReorderableListReorderEvent) {
    applyNewOrder(reorderItems(filtered, from, to));
  }

  function handleDelete(routine: Routine) {
    Alert.alert('루틴을 삭제할까요?', `"${routine.title}"에 해당하는 모든 예정이 삭제돼요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await softDeleteRoutine(routine.id);
            setRoutines((prev) => prev.filter((r) => r.id !== routine.id));
          } catch {
            setErrorMessage('삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))));
  }

  function handleBulkDeleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    Alert.alert('선택한 루틴을 삭제할까요?', `${count}개 루틴에 해당하는 모든 예정이 삭제돼요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          const ids = Array.from(selectedIds);
          try {
            await softDeleteRoutines(ids);
            setRoutines((prev) => prev.filter((r) => !selectedIds.has(r.id)));
            setSelectedIds(new Set());
            setSelectMode(false);
          } catch {
            setErrorMessage('삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextColumn}>
            <Text style={styles.title}>내 루틴</Text>
            <Text style={styles.subtitle}>오늘 예정 여부와 상관없이 전체 루틴을 보고 수정할 수 있어요</Text>
          </View>
          <Pressable style={styles.addButton} onPress={() => router.push('/routine-trash')}>
            <Text style={styles.addButtonText}>♻️ 루틴 복구</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.groupModeTabs}>
        <Pressable
          style={[styles.groupModeTab, groupMode === 'repeat' && styles.groupModeTabActive]}
          onPress={() => switchGroupMode('repeat')}>
          <Text style={[styles.groupModeTabText, groupMode === 'repeat' && styles.groupModeTabTextActive]}>
            반복 주기
          </Text>
        </Pressable>
        <Pressable
          style={[styles.groupModeTab, groupMode === 'preset' && styles.groupModeTabActive]}
          onPress={() => switchGroupMode('preset')}>
          <Text style={[styles.groupModeTabText, groupMode === 'preset' && styles.groupModeTabTextActive]}>
            모음집
          </Text>
        </Pressable>
      </View>

      {groupMode === 'repeat' ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
          data={FILTERS}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.filterChip, filter === item.value && styles.filterChipActive]}
              onPress={() => setFilter(item.value)}>
              <Text style={[styles.filterChipText, filter === item.value && styles.filterChipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      ) : presets.length === 0 ? (
        <Text style={styles.noPresetsText}>아직 만든 모음집이 없어요.</Text>
      ) : (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
          data={presets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.filterChip, presetFilter === item.id && styles.filterChipActive]}
              onPress={() => setPresetFilter((prev) => (prev === item.id ? null : item.id))}>
              <Text style={[styles.filterChipText, presetFilter === item.id && styles.filterChipTextActive]}>
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.toolbarRow}>
        {selectMode ? (
          <>
            <Text style={styles.selectedCountText}>{selectedIds.size}개 선택됨</Text>
            <Pressable style={styles.toolbarButton} onPress={toggleSelectAll}>
              <Text style={styles.toolbarButtonText}>
                {selectedIds.size === filtered.length ? '전체 해제' : '전체 선택'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.toolbarButton}
              disabled={selectedIds.size === 0}
              onPress={handleBulkDeleteSelected}>
              <Text style={styles.toolbarButtonDangerText}>삭제</Text>
            </Pressable>
            <Pressable style={styles.toolbarButton} onPress={toggleSelectMode}>
              <Text style={styles.toolbarButtonText}>취소</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.toolbarButton} onPress={toggleSelectMode}>
            <Text style={styles.toolbarButtonText}>선택 삭제</Text>
          </Pressable>
        )}
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {!selectMode && filtered.length > 1 && (
        <Text style={styles.dragHint}>≡ 를 길게 눌러 드래그하면 순서를 바꿀 수 있어요</Text>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {groupMode === 'preset' && presetFilter === null
              ? '위에서 모음집을 골라주세요'
              : '해당하는 루틴이 없어요'}
          </Text>
        </View>
      ) : (
        <ReorderableList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(item) => item.id}
          onReorder={handleReorder}
          renderItem={({ item }) => (
            <RoutineRow
              routine={item}
              selectMode={selectMode}
              isSelected={selectedIds.has(item.id)}
              onEdit={() => router.push({ pathname: '/routine-form', params: { id: item.id } })}
              onToggleSelect={() => toggleSelected(item.id)}
              onDelete={() => handleDelete(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTextColumn: {
    flex: 1,
  },
  addButton: {
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 4,
    lineHeight: 16,
  },
  groupModeTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 92, 252, 0.08)',
    padding: 4,
    gap: 4,
  },
  groupModeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  groupModeTabActive: {
    backgroundColor: '#7C5CFC',
  },
  groupModeTabText: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.6,
  },
  groupModeTabTextActive: {
    color: '#fff',
    opacity: 1,
  },
  noPresetsText: {
    fontSize: 12,
    opacity: 0.45,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  filterRow: {
    flexGrow: 0,
    marginBottom: 12,
  },
  filterRowContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: '#7C5CFC',
  },
  filterChipText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 8,
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
  toolbarButtonDangerText: {
    fontSize: 13,
    color: '#FF6B6B',
    fontWeight: '600',
  },
  dragHint: {
    fontSize: 11,
    opacity: 0.45,
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  error: {
    color: '#FF6B6B',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyText: {
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
  },
  rowMeta: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 4,
  },
  dragHandle: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  dragHandleText: {
    fontSize: 18,
    opacity: 0.35,
  },
  checkbox: {
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
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
    fontSize: 13,
    fontWeight: 'bold',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteButtonText: {
    fontSize: 12,
    color: '#FF6B6B',
    fontWeight: '600',
  },
});
