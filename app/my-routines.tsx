import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet } from 'react-native';
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { Text, View } from '@/components/Themed';
import { accent, border, cardRadius } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { deletePreset, fetchPresets, type RoutinePreset } from '@/lib/presets';
import {
  fetchAllRoutines,
  fetchSkippedRoutineIds,
  formatLocalDate,
  softDeleteRoutine,
  softDeleteRoutines,
  unskipRoutine,
  updateSortOrder,
  SLOT_LABELS,
  type RepeatType,
  type Routine,
} from '@/lib/routines';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';

type FilterValue = RepeatType | 'all';

const PRESET_CHIP_GAP = 8;
const PRESET_CHIPS_PER_ROW = 4;
const PRESET_NAME_MAX_CHARS = 8;

// 이름은 8글자까지만 보여주고 그 뒤는 자른다 (가로 스크롤로 어차피 옆 칩을 볼 수 있어서
// 말줄임 계산 없이 그냥 글자 수로 끊는다)
function truncatePresetName(name: string): string {
  return name.length > PRESET_NAME_MAX_CHARS ? name.slice(0, PRESET_NAME_MAX_CHARS) : name;
}

// 처음 12개(4개씩 3줄)까지는 순서대로 채우고, 그 이후로 늘어나는 칩은 1번째→2번째→3번째 줄에
// 한 개씩 돌아가며 추가한다 — 항상 정확히 3줄을 유지하면서 줄 사이 개수 균형을 맞춘다.
// 3줄 전체가 하나의 가로 스크롤로 묶여서 넘치면 오른쪽으로 당겨서 본다.
function layoutPresetRows(items: RoutinePreset[]): RoutinePreset[][] {
  const rows: RoutinePreset[][] = [[], [], []];
  const initialFillCount = PRESET_CHIPS_PER_ROW * rows.length;
  items.forEach((item, index) => {
    const rowIndex =
      index < initialFillCount
        ? Math.floor(index / PRESET_CHIPS_PER_ROW)
        : (index - initialFillCount) % rows.length;
    rows[rowIndex].push(item);
  });
  return rows;
}

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
  if (routine.is_instant && routine.scheduled_time_start) {
    return routine.scheduled_time_start.slice(0, 5);
  }
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
  isSkippedToday,
  onEdit,
  onToggleSelect,
  onDelete,
  onUnskip,
}: {
  routine: Routine;
  selectMode: boolean;
  isSelected: boolean;
  isSkippedToday: boolean;
  onEdit: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  onUnskip: () => void;
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
          {isSkippedToday ? ' · 오늘 제외됨' : ''}
        </Text>
      </Pressable>
      {!selectMode && isSkippedToday && (
        <Pressable style={styles.unskipButton} onPress={onUnskip} hitSlop={8}>
          <Text style={styles.unskipButtonText}>오늘 목록에 추가</Text>
        </Pressable>
      )}
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
  const queryClient = useQueryClient();
  const routinesQueryKey = ['all-routines', userId] as const;
  // presets 탭 화면과 정확히 같은 쿼리 키를 써서 캐시를 공유한다
  const presetsQueryKey = ['presets', userId] as const;
  const todayDateStr = formatLocalDate(new Date());
  const skippedTodayQueryKey = ['today-skips', userId, todayDateStr] as const;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<'repeat' | 'preset'>('repeat');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [presetFilter, setPresetFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const routinesQuery = useQuery({
    queryKey: routinesQueryKey,
    queryFn: () => fetchAllRoutines(userId!),
    enabled: !!userId,
  });
  const presetsQuery = useQuery({
    queryKey: presetsQueryKey,
    queryFn: () => fetchPresets(userId!),
    enabled: !!userId,
  });
  // 오늘 탭에서 스와이프로 "오늘 삭제"된(건너뛴) 루틴 — 여기서 다시 오늘 목록에 추가할 수 있게 표시
  const skippedTodayQuery = useQuery({
    queryKey: skippedTodayQueryKey,
    queryFn: () => fetchSkippedRoutineIds(todayDateStr),
    enabled: !!userId,
  });
  const refetchAll = useCallback(() => {
    routinesQuery.refetch();
    presetsQuery.refetch();
    skippedTodayQuery.refetch();
  }, [routinesQuery.refetch, presetsQuery.refetch, skippedTodayQuery.refetch]);
  useRefetchOnFocus(refetchAll);

  const routines = routinesQuery.data ?? [];
  const presets = presetsQuery.data ?? [];
  const skippedTodayIds = skippedTodayQuery.data ?? new Set<string>();
  const isLoading = routinesQuery.isLoading || presetsQuery.isLoading;

  async function handleUnskip(routine: Routine) {
    try {
      await unskipRoutine(routine.id, todayDateStr);
      queryClient.setQueryData(skippedTodayQueryKey, (prev?: Set<string>) => {
        const next = new Set(prev);
        next.delete(routine.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['today-routines', userId] });
    } catch {
      setErrorMessage('되돌리기에 실패했어요.');
    }
  }

  function setRoutines(next: Routine[]) {
    queryClient.setQueryData(routinesQueryKey, next);
  }

  function setPresets(updater: (prev: RoutinePreset[]) => RoutinePreset[]) {
    queryClient.setQueryData(presetsQueryKey, (old?: RoutinePreset[]) => updater(old ?? []));
  }

  useEffect(() => {
    if (routinesQuery.isError || presetsQuery.isError) setErrorMessage('루틴을 불러오지 못했어요.');
  }, [routinesQuery.isError, presetsQuery.isError]);

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
    updateSortOrder(merged.map((r) => r.id)).catch(() => routinesQuery.refetch());
  }

  function handleReorder({ from, to }: ReorderableListReorderEvent) {
    applyNewOrder(reorderItems(filtered, from, to));
  }

  // 이 삭제로 인해 하나도 안 남게 되는 모음집(preset)들을 찾는다 — 모음집 자체를 지울지는
  // 자동으로 정하지 않고, 사용자가 확인창에서 "모음집도 삭제" 버튼을 직접 눌러야만 지운다
  // (모음집 템플릿과 실제 루틴은 별개 개념이라, 루틴을 다 지웠다고 모음집까지 자동으로
  // 사라지면 의도치 않게 템플릿까지 잃을 수 있어서)
  function emptiedPresets(deletedRoutines: Routine[], remainingRoutines: Routine[]): RoutinePreset[] {
    const affectedPresetIds = Array.from(
      new Set(deletedRoutines.map((r) => r.preset_id).filter((id): id is string => id != null))
    );
    const nowEmptyPresetIds = affectedPresetIds.filter(
      (presetId) => !remainingRoutines.some((r) => r.preset_id === presetId)
    );
    return presets.filter((p) => nowEmptyPresetIds.includes(p.id));
  }

  async function deletePresetsById(presetIds: string[]) {
    if (presetIds.length === 0) return;
    await Promise.all(presetIds.map((id) => deletePreset(id)));
    setPresets((prev) => prev.filter((p) => !presetIds.includes(p.id)));
    setPresetFilter((prev) => (prev && presetIds.includes(prev) ? null : prev));
  }

  async function performDelete(routine: Routine, remaining: Routine[], presetIdsToDelete: string[] = []) {
    try {
      await softDeleteRoutine(routine.id);
      setRoutines(remaining);
      await deletePresetsById(presetIdsToDelete);
    } catch {
      setErrorMessage('삭제에 실패했어요.');
    }
  }

  function handleDelete(routine: Routine) {
    const remaining = routines.filter((r) => r.id !== routine.id);
    const emptied = emptiedPresets([routine], remaining);

    if (emptied.length > 0) {
      const preset = emptied[0];
      Alert.alert(
        '루틴을 삭제할까요?',
        `"${routine.title}"을(를) 지우면 "${preset.name}" 모음집에 남은 루틴이 없어져요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '루틴만 삭제', onPress: () => performDelete(routine, remaining) },
          { text: '모음집도 삭제', style: 'destructive', onPress: () => performDelete(routine, remaining, [preset.id]) },
        ]
      );
      return;
    }

    Alert.alert('루틴을 삭제할까요?', `"${routine.title}"에 해당하는 모든 예정이 삭제돼요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => performDelete(routine, remaining) },
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

  async function performBulkDelete(ids: string[], remaining: Routine[], presetIdsToDelete: string[] = []) {
    try {
      await softDeleteRoutines(ids);
      setRoutines(remaining);
      setSelectedIds(new Set());
      setSelectMode(false);
      await deletePresetsById(presetIdsToDelete);
    } catch {
      setErrorMessage('삭제에 실패했어요.');
    }
  }

  function handleBulkDeleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    const deleted = routines.filter((r) => selectedIds.has(r.id));
    const remaining = routines.filter((r) => !selectedIds.has(r.id));
    const emptied = emptiedPresets(deleted, remaining);

    if (emptied.length > 0) {
      const names = emptied.map((p) => `"${p.name}"`).join(', ');
      Alert.alert(
        '선택한 루틴을 삭제할까요?',
        `${count}개 루틴에 해당하는 모든 예정이 삭제돼요. ${names} 모음집에 남은 루틴이 없어져요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '루틴만 삭제', onPress: () => performBulkDelete(ids, remaining) },
          {
            text: '모음집도 삭제',
            style: 'destructive',
            onPress: () => performBulkDelete(ids, remaining, emptied.map((p) => p.id)),
          },
        ]
      );
      return;
    }

    Alert.alert('선택한 루틴을 삭제할까요?', `${count}개 루틴에 해당하는 모든 예정이 삭제돼요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => performBulkDelete(ids, remaining) },
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
          key="repeat-filter"
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
        // 항상 정확히 3줄 — 처음 12개는 4개씩 순서대로, 그 이후는 줄마다 한 개씩 돌아가며 추가.
        // 3줄 전체가 하나의 가로 스크롤로 묶여서, 넘치면 오른쪽으로 당겨서 본다.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.presetFilterScroll}>
          <View>
            {layoutPresetRows(presets).map((row, rowIndex) => (
              <View key={rowIndex} style={styles.presetFilterRow}>
                {row.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.filterChip, presetFilter === item.id && styles.filterChipActive]}
                    onPress={() => setPresetFilter((prev) => (prev === item.id ? null : item.id))}>
                    <Text style={[styles.filterChipText, presetFilter === item.id && styles.filterChipTextActive]}>
                      {truncatePresetName(item.name)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
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
              isSkippedToday={skippedTodayIds.has(item.id)}
              onEdit={() => router.push({ pathname: '/routine-form', params: { id: item.id } })}
              onToggleSelect={() => toggleSelected(item.id)}
              onDelete={() => handleDelete(item)}
              onUnskip={() => handleUnskip(item)}
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
    backgroundColor: accent,
    borderRadius: cardRadius,
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
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.08)',
    padding: 4,
    gap: 4,
  },
  groupModeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: cardRadius,
    alignItems: 'center',
  },
  groupModeTabActive: {
    backgroundColor: accent,
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
  presetFilterScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  presetFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: PRESET_CHIP_GAP,
    marginBottom: PRESET_CHIP_GAP,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: accent,
  },
  filterChipText: {
    color: accent,
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
    color: accent,
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
    borderRadius: cardRadius,
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
    borderRadius: cardRadius,
    borderWidth: 1.5,
    borderColor: accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: accent,
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteButtonText: {
    fontSize: 12,
    color: '#FF6B6B',
    fontWeight: '600',
  },
  unskipButton: {
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unskipButtonText: {
    fontSize: 12,
    color: accent,
    fontWeight: '600',
  },
});
