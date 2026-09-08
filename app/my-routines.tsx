import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text, View } from '@/components/Themed';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
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
  SLOT_LABEL_KEYS,
  type RepeatType,
  type Routine,
} from '@/lib/routines';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';

type FilterValue = RepeatType | 'all';
type OnceSubFilter = 'active' | 'past';

const PRESET_CHIP_GAP = 8;
const PRESET_CHIPS_PER_ROW = 4;
const PRESET_NAME_MAX_CHARS = 8;
const MY_ROUTINES_NOTICE_SEEN_KEY = 'my_routines_notice_seen';

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

type TFunc = (key: TranslationKey) => string;

const REPEAT_LABEL_KEYS: Record<RepeatType, TranslationKey> = {
  daily: 'myRoutines.repeatDaily',
  weekday: 'myRoutines.repeatWeekday',
  weekend: 'myRoutines.repeatWeekend',
  custom: 'myRoutines.repeatCustom',
  once: 'myRoutines.repeatOnce',
};

function timeLabel(routine: Routine, t: TFunc): string {
  if (routine.is_instant && routine.scheduled_time_start) {
    return routine.scheduled_time_start.slice(0, 5);
  }
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return t(SLOT_LABEL_KEYS[routine.slots.slot_type]);
  return t('myRoutines.noScheduledTime');
}

function metaLabel(routine: Routine, t: TFunc): string {
  const parts = [t(REPEAT_LABEL_KEYS[routine.repeat_type]), timeLabel(routine, t)];
  if (routine.preset?.name) parts.push(routine.preset.name);
  if (routine.is_paused) parts.push(t('myRoutines.paused'));
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
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  return (
    <View style={styles.row}>
      {selectMode ? (
        <AnimatedPressable style={styles.checkbox} onPress={onToggleSelect} hitSlop={8}>
          <View style={[styles.checkboxBox, isSelected && styles.checkboxBoxChecked]}>
            {isSelected && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
        </AnimatedPressable>
      ) : (
        <AnimatedPressable onLongPress={drag} delayLongPress={150} style={styles.dragHandle} hitSlop={8}>
          <Text style={styles.dragHandleText}>≡</Text>
        </AnimatedPressable>
      )}
      <AnimatedPressable style={styles.rowMain} onPress={selectMode ? onToggleSelect : onEdit}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {routine.title}
          {routine.is_required ? t('myRoutines.requiredSuffix') : ''}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {metaLabel(routine, t)}
          {isSkippedToday ? t('myRoutines.skippedTodaySuffix') : ''}
        </Text>
      </AnimatedPressable>
      {!selectMode && isSkippedToday && (
        <AnimatedPressable style={styles.unskipButton} onPress={onUnskip} hitSlop={8}>
          <Text style={styles.unskipButtonText}>{t('myRoutines.addToToday')}</Text>
        </AnimatedPressable>
      )}
      {!selectMode && (
        <AnimatedPressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
          <Text style={styles.deleteButtonText}>{t('myRoutines.delete')}</Text>
        </AnimatedPressable>
      )}
    </View>
  );
}

export default function MyRoutinesScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  const FILTERS = useMemo<{ value: FilterValue; label: string }[]>(
    () => [
      { value: 'all', label: t('myRoutines.filterAll') },
      { value: 'daily', label: t('myRoutines.filterDaily') },
      { value: 'weekday', label: t('myRoutines.filterWeekday') },
      { value: 'weekend', label: t('myRoutines.filterWeekend') },
      { value: 'custom', label: t('myRoutines.filterCustom') },
      { value: 'once', label: t('myRoutines.filterOnce') },
    ],
    [t]
  );
  const ONCE_SUB_FILTERS = useMemo<{ value: OnceSubFilter; label: string }[]>(
    () => [
      { value: 'active', label: t('myRoutines.onceActive') },
      { value: 'past', label: t('myRoutines.oncePast') },
    ],
    [t]
  );
  const routinesQueryKey = ['all-routines', userId] as const;
  // presets 탭 화면과 정확히 같은 쿼리 키를 써서 캐시를 공유한다
  const presetsQueryKey = ['presets', userId] as const;
  const todayDateStr = formatLocalDate(new Date());
  const skippedTodayQueryKey = ['today-skips', userId, todayDateStr] as const;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<'repeat' | 'preset'>('repeat');
  const [filter, setFilter] = useState<FilterValue>('all');
  // "1회성" 필터를 골랐을 때만 쓰는 하위 구분 — 오늘 이후 vs 날짜 지난 것
  const [onceSubFilter, setOnceSubFilter] = useState<OnceSubFilter>('active');
  const [presetFilter, setPresetFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSubtitle, setShowSubtitle] = useState(false);

  // 안내글은 최초 1회만 자동으로 펼쳐서 보여주고, 그다음부터는 ⓘ 아이콘만 남아있다가 누르면 펼쳐짐
  useEffect(() => {
    AsyncStorage.getItem(MY_ROUTINES_NOTICE_SEEN_KEY).then((seen) => {
      if (seen === 'true') return;
      setShowSubtitle(true);
      AsyncStorage.setItem(MY_ROUTINES_NOTICE_SEEN_KEY, 'true');
    });
  }, []);

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
  useRefetchOnFocus(refetchAll, !!userId);

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
      setErrorMessage(t('myRoutines.errorUnskip'));
    }
  }

  function setRoutines(next: Routine[]) {
    queryClient.setQueryData(routinesQueryKey, next);
  }

  function setPresets(updater: (prev: RoutinePreset[]) => RoutinePreset[]) {
    queryClient.setQueryData(presetsQueryKey, (old?: RoutinePreset[]) => updater(old ?? []));
  }

  useEffect(() => {
    if (routinesQuery.isError || presetsQuery.isError) setErrorMessage(t('myRoutines.errorLoad'));
  }, [routinesQuery.isError, presetsQuery.isError]);

  // 1회성 루틴은 지정한 날짜가 지나면 다시 활성화될 일이 없어서, "전체"/모음집 등
  // 다른 카테고리에서는 안 보이게 숨긴다. 완료기록은 그대로 남아있어야 하므로 삭제는 절대 안 하고,
  // "지난 1회성" 필터에서만 따로 모아 보여준다(사용자가 필요하면 거기서 직접 삭제)
  function isPastOnce(r: Routine): boolean {
    return r.repeat_type === 'once' && !!r.scheduled_date && r.scheduled_date < todayDateStr;
  }

  const filtered = routines.filter((r) => {
    if (groupMode === 'repeat') {
      if (filter === 'all') return !isPastOnce(r);
      if (filter === 'once') return r.repeat_type === 'once' && (onceSubFilter === 'past' ? isPastOnce(r) : !isPastOnce(r));
      return r.repeat_type === filter;
    }
    // 모음집 탭에서는 특정 모음집을 고르기 전까지는 아무것도 안 보여준다 —
    // "반복 주기" 탭에서 보이던 목록이 그대로 남아있으면 헷갈려서
    return presetFilter !== null && r.preset_id === presetFilter && !isPastOnce(r);
  });

  function selectFilter(value: FilterValue) {
    setFilter(value);
    setOnceSubFilter('active');
  }

  function switchGroupMode(mode: 'repeat' | 'preset') {
    setGroupMode(mode);
    setFilter('all');
    setOnceSubFilter('active');
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
      setErrorMessage(t('myRoutines.errorDelete'));
    }
  }

  function handleDelete(routine: Routine) {
    const remaining = routines.filter((r) => r.id !== routine.id);
    const emptied = emptiedPresets([routine], remaining);

    if (emptied.length > 0) {
      const preset = emptied[0];
      const message =
        language === 'ko'
          ? `"${routine.title}"을(를) 지우면 "${preset.name}" 모음집에 남은 루틴이 없어져요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`
          : `Deleting "${routine.title}" will leave "${preset.name}" with no routines left. You can restore it within 2 weeks from "Routine Recovery".`;
      Alert.alert(t('myRoutines.deleteRoutineTitle'), message, [
        { text: t('settings.cancel'), style: 'cancel' },
        { text: t('myRoutines.deleteRoutineOnly'), onPress: () => performDelete(routine, remaining) },
        { text: t('myRoutines.deletePresetToo'), style: 'destructive', onPress: () => performDelete(routine, remaining, [preset.id]) },
      ]);
      return;
    }

    const message =
      language === 'ko'
        ? `"${routine.title}"에 해당하는 모든 예정이 삭제돼요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`
        : `All occurrences of "${routine.title}" will be deleted. You can restore it within 2 weeks from "Routine Recovery".`;
    Alert.alert(t('myRoutines.deleteRoutineTitle'), message, [
      { text: t('settings.cancel'), style: 'cancel' },
      { text: t('myRoutines.delete'), style: 'destructive', onPress: () => performDelete(routine, remaining) },
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
      setErrorMessage(t('myRoutines.errorDelete'));
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
      const message =
        language === 'ko'
          ? `${count}개 루틴에 해당하는 모든 예정이 삭제돼요. ${names} 모음집에 남은 루틴이 없어져요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`
          : `All occurrences of ${count} routines will be deleted. ${names} will have no routines left. You can restore within 2 weeks from "Routine Recovery".`;
      Alert.alert(t('myRoutines.deleteSelectedTitle'), message, [
        { text: t('settings.cancel'), style: 'cancel' },
        { text: t('myRoutines.deleteRoutineOnly'), onPress: () => performBulkDelete(ids, remaining) },
        {
          text: t('myRoutines.deletePresetToo'),
          style: 'destructive',
          onPress: () => performBulkDelete(ids, remaining, emptied.map((p) => p.id)),
        },
      ]);
      return;
    }

    const message =
      language === 'ko'
        ? `${count}개 루틴에 해당하는 모든 예정이 삭제돼요. "루틴 복구"에서 2주 안에 되돌릴 수 있어요.`
        : `All occurrences of ${count} routines will be deleted. You can restore within 2 weeks from "Routine Recovery".`;
    Alert.alert(t('myRoutines.deleteSelectedTitle'), message, [
      { text: t('settings.cancel'), style: 'cancel' },
      { text: t('myRoutines.delete'), style: 'destructive', onPress: () => performBulkDelete(ids, remaining) },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextColumn}>
            {showSubtitle ? (
              <AnimatedPressable onPress={() => setShowSubtitle(false)}>
                <Text style={styles.subtitle}>{t('myRoutines.subtitle')}</Text>
              </AnimatedPressable>
            ) : (
              <AnimatedPressable style={styles.subtitleCollapsed} onPress={() => setShowSubtitle(true)} hitSlop={8}>
                <Text style={styles.subtitleIcon}>ⓘ</Text>
              </AnimatedPressable>
            )}
          </View>
          <AnimatedPressable style={styles.addButton} onPress={() => router.push('/routine-trash')}>
            <Ionicons name="refresh-outline" size={13} color="#fff" />
            <Text style={styles.addButtonText}>{t('myRoutines.routineTrash')}</Text>
          </AnimatedPressable>
        </View>
      </View>

      <View style={styles.groupModeTabs}>
        <AnimatedPressable
          style={[styles.groupModeTab, groupMode === 'repeat' && styles.groupModeTabActive]}
          onPress={() => switchGroupMode('repeat')}>
          <Text style={[styles.groupModeTabText, groupMode === 'repeat' && styles.groupModeTabTextActive]}>
            {t('myRoutines.groupRepeat')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.groupModeTab, groupMode === 'preset' && styles.groupModeTabActive]}
          onPress={() => switchGroupMode('preset')}>
          <Text style={[styles.groupModeTabText, groupMode === 'preset' && styles.groupModeTabTextActive]}>
            {t('myRoutines.groupPreset')}
          </Text>
        </AnimatedPressable>
      </View>

      {groupMode === 'repeat' ? (
        <>
          <FlatList
            key="repeat-filter"
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterRowContent}
            data={FILTERS}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <AnimatedPressable
                style={[styles.filterChip, filter === item.value && styles.filterChipActive]}
                onPress={() => selectFilter(item.value)}>
                <Text style={[styles.filterChipText, filter === item.value && styles.filterChipTextActive]}>
                  {item.label}
                </Text>
              </AnimatedPressable>
            )}
          />
          {filter === 'once' && (
            <View style={styles.onceSubFilterRow}>
              {ONCE_SUB_FILTERS.map((item) => (
                <AnimatedPressable
                  key={item.value}
                  style={[styles.onceSubFilterChip, onceSubFilter === item.value && styles.onceSubFilterChipActive]}
                  onPress={() => setOnceSubFilter(item.value)}>
                  <Text
                    style={[
                      styles.onceSubFilterChipText,
                      onceSubFilter === item.value && styles.onceSubFilterChipTextActive,
                    ]}>
                    {item.label}
                  </Text>
                </AnimatedPressable>
              ))}
            </View>
          )}
        </>
      ) : presets.length === 0 ? (
        <Text style={styles.noPresetsText}>{t('myRoutines.noPresets')}</Text>
      ) : (
        // 항상 정확히 3줄 — 처음 12개는 4개씩 순서대로, 그 이후는 줄마다 한 개씩 돌아가며 추가.
        // 3줄 전체가 하나의 가로 스크롤로 묶여서, 넘치면 오른쪽으로 당겨서 본다.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.presetFilterScroll}>
          <View>
            {layoutPresetRows(presets)
              .filter((row) => row.length > 0)
              .map((row, rowIndex) => (
              <View key={rowIndex} style={styles.presetFilterRow}>
                {row.map((item) => (
                  <AnimatedPressable
                    key={item.id}
                    style={[styles.filterChip, presetFilter === item.id && styles.filterChipActive]}
                    onPress={() => setPresetFilter((prev) => (prev === item.id ? null : item.id))}>
                    <Text style={[styles.filterChipText, presetFilter === item.id && styles.filterChipTextActive]}>
                      {truncatePresetName(item.name)}
                    </Text>
                  </AnimatedPressable>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <View style={styles.toolbarRow}>
        {selectMode ? (
          <>
            <Text style={styles.selectedCountText}>
              {selectedIds.size}
              {t('myRoutines.selectedCountSuffix')}
            </Text>
            <AnimatedPressable style={styles.toolbarButton} onPress={toggleSelectAll}>
              <Text style={styles.toolbarButtonText}>
                {selectedIds.size === filtered.length ? t('myRoutines.deselectAll') : t('myRoutines.selectAll')}
              </Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.toolbarButton}
              disabled={selectedIds.size === 0}
              onPress={handleBulkDeleteSelected}>
              <Text style={styles.toolbarButtonDangerText}>{t('myRoutines.delete')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.toolbarButton} onPress={toggleSelectMode}>
              <Text style={styles.toolbarButtonText}>{t('settings.cancel')}</Text>
            </AnimatedPressable>
          </>
        ) : (
          <AnimatedPressable style={styles.toolbarButton} onPress={toggleSelectMode}>
            <Text style={styles.toolbarButtonText}>{t('myRoutines.bulkDelete')}</Text>
          </AnimatedPressable>
        )}
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {!selectMode && filtered.length > 1 && (
        <Text style={styles.dragHint}>{t('myRoutines.dragHint')}</Text>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {groupMode === 'preset' && presetFilter === null
              ? t('myRoutines.emptyChoosePreset')
              : t('myRoutines.emptyNoMatch')}
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

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 20,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  subtitle: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 4,
    lineHeight: 16,
  },
  subtitleCollapsed: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  subtitleIcon: {
    fontSize: 14,
    color: '#999',
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
    // 마지막 줄(presetFilterRow)에도 이미 자체 marginBottom(PRESET_CHIP_GAP)이 있어서, 여기까지
    // 12를 더 주면 "선택 삭제" 버튼과 간격이 너무 벌어짐 — 둘을 합쳐 12가 되도록 줄임
    marginBottom: 4,
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
  onceSubFilterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  onceSubFilterChip: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  onceSubFilterChipActive: {
    backgroundColor: accent,
    borderColor: accent,
  },
  onceSubFilterChipText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  onceSubFilterChipTextActive: {
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
    fontSize: 16 + fontKorean.sizeAdjust,
    lineHeight: 21 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
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
}
