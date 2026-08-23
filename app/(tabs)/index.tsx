import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { fetchLlmQuota, type LlmQuota } from '@/lib/llm';
import {
  requestNotificationPermissions,
  setupNotificationChannel,
  syncReminderAlarm,
  syncSlotAlarms,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import {
  effectiveTimeRange,
  emojiForStreak,
  fetchStreakConfigs,
  fetchStreaks,
  fetchTodayRoutines,
  formatLocalDate,
  isHappeningNow,
  saveTrackingValue,
  skipRoutineToday,
  toggleCheckCompletion,
  SLOT_LABELS,
  type Holiday,
  type Routine,
  type RoutineCompletion,
  type StreakConfig,
} from '@/lib/routines';

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function timeLabel(routine: Routine): string {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${formatTime(routine.scheduled_time_start)}-${formatTime(routine.scheduled_time_end)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '';
}

const HOUR_HEIGHT = 56;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

type TimedBlock = { id: string; top: number; height: number };

// 같은 시간대(또는 겹치는 시간대)에 여러 루틴이 있으면 겹쳐 그리지 않고 옆으로 나란히 배치한다
function assignColumns(items: TimedBlock[]): Map<string, { col: number; totalCols: number }> {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const result = new Map<string, { col: number; totalCols: number }>();
  let cluster: TimedBlock[] = [];
  let clusterMaxBottom = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const colEnds: number[] = [];
    for (const item of cluster) {
      let col = colEnds.findIndex((end) => end <= item.top);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.top + item.height);
      } else {
        colEnds[col] = item.top + item.height;
      }
      result.set(item.id, { col, totalCols: -1 }); // totalCols는 클러스터 끝나고 일괄 채움
    }
    const totalCols = colEnds.length;
    for (const item of cluster) result.set(item.id, { col: result.get(item.id)!.col, totalCols });
    cluster = [];
  }

  for (const item of sorted) {
    if (item.top >= clusterMaxBottom) flushCluster();
    clusterMaxBottom = Math.max(clusterMaxBottom, item.top + item.height);
    cluster.push(item);
  }
  flushCluster();
  return result;
}

// 타임라인 뷰: 시간축에 루틴을 세로로 배치해서 하루 일정을 한눈에 보여줌
function TimelineView({
  routines,
  completions,
  onToggleCheck,
  onEdit,
}: {
  routines: Routine[];
  completions: Record<string, RoutineCompletion>;
  onToggleCheck: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
}) {
  const timed = routines
    .map((routine) => ({
      routine,
      range: effectiveTimeRange(routine),
      isExact: Boolean(routine.scheduled_time_start && routine.scheduled_time_end),
    }))
    .filter(
      (r): r is { routine: Routine; range: { start: string; end: string }; isExact: boolean } => r.range !== null
    );

  if (timed.length === 0) {
    return (
      <View style={timelineStyles.emptyContainer}>
        <Text style={timelineStyles.emptyText}>시간 정보가 있는 루틴이 없어요</Text>
      </View>
    );
  }

  // 슬롯(아침/점심 등)은 범위 전체를 채우지 않고 시작 시각에 작은 블록으로만 표시 —
  // 안 그러면 슬롯 범위(예: 5~11시)가 통째로 다른 블록과 겹쳐서 클릭이 씹힌다
  const startHours = timed.map((r) => Math.floor(toMinutes(r.range.start) / 60));
  const endHours = timed.map((r) => (r.isExact ? Math.ceil(toMinutes(r.range.end) / 60) : startHours[0]));
  const minHour = Math.max(0, Math.min(6, ...startHours));
  const maxHour = Math.min(24, Math.max(22, ...timed.map((r, i) => (r.isExact ? endHours[i] : startHours[i] + 1))));
  const totalHeight = (maxHour - minHour) * HOUR_HEIGHT;

  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i);

  const positioned = timed.map(({ routine, range, isExact }) => {
    const top = (toMinutes(range.start) - minHour * 60) * (HOUR_HEIGHT / 60);
    const rawHeight = isExact ? (toMinutes(range.end) - toMinutes(range.start)) * (HOUR_HEIGHT / 60) : 0;
    const height = Math.max(rawHeight, 34);
    return { routine, range, top, height };
  });
  const columns = assignColumns(positioned.map((p) => ({ id: p.routine.id, top: p.top, height: p.height })));

  return (
    <ScrollView style={timelineStyles.container} contentContainerStyle={{ height: totalHeight + 20 }}>
      {hours.map((hour) => (
        <View
          key={hour}
          style={[timelineStyles.hourLine, { top: (hour - minHour) * HOUR_HEIGHT }]}>
          <Text style={timelineStyles.hourLabel}>{String(hour).padStart(2, '0')}:00</Text>
        </View>
      ))}

      <View style={timelineStyles.blocksArea}>
        {positioned.map(({ routine, range, top, height }) => {
          const completion = completions[routine.id];
          const isDone = Boolean(completion);
          const { col, totalCols } = columns.get(routine.id) ?? { col: 0, totalCols: 1 };
          const widthPercent = 100 / totalCols;
          const gap = totalCols > 1 ? 2 : 0;
          return (
            <View
              key={routine.id}
              style={[
                timelineStyles.block,
                {
                  top,
                  height,
                  left: `${col * widthPercent}%`,
                  width: `${Math.max(widthPercent - gap, 10)}%`,
                },
                isDone && timelineStyles.blockDone,
              ]}>
              <Pressable style={timelineStyles.blockContent} onPress={() => onEdit(routine)}>
                {totalCols === 1 && <Text style={timelineStyles.blockTime}>{formatTime(range.start)}</Text>}
                <Text style={[timelineStyles.blockTitle, isDone && timelineStyles.blockTitleDone]} numberOfLines={1}>
                  {routine.title}
                </Text>
              </Pressable>
              {routine.block_type === 'check' ? (
                <Pressable
                  hitSlop={8}
                  style={[timelineStyles.blockCheckbox, isDone && timelineStyles.blockCheckboxDone]}
                  onPress={() => onToggleCheck(routine)}>
                  {isDone && <Text style={timelineStyles.blockCheckmark}>✓</Text>}
                </Pressable>
              ) : totalCols === 1 ? (
                <Text style={timelineStyles.blockTrackingValue}>
                  {completion?.tracking_value ?? '-'} {routine.tracking_unit}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const timelineStyles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: 20,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    opacity: 0.5,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#eee',
    justifyContent: 'center',
  },
  hourLabel: {
    fontSize: 10,
    opacity: 0.4,
    position: 'absolute',
    top: -7,
  },
  blocksArea: {
    position: 'absolute',
    left: 46,
    right: 0,
    top: 0,
    bottom: 0,
  },
  block: {
    position: 'absolute',
    backgroundColor: 'rgba(124, 92, 252, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: '#7C5CFC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  blockDone: {
    opacity: 0.5,
  },
  blockContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blockTime: {
    fontSize: 11,
    opacity: 0.6,
    width: 36,
  },
  blockTitle: {
    flex: 1,
    fontSize: 13,
  },
  blockTitleDone: {
    textDecorationLine: 'line-through',
  },
  blockCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#7C5CFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockCheckboxDone: {
    backgroundColor: '#7C5CFC',
  },
  blockCheckmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  blockTrackingValue: {
    fontSize: 12,
    opacity: 0.7,
  },
});

export default function TodayScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [completions, setCompletions] = useState<Record<string, RoutineCompletion>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  const [holiday, setHoliday] = useState<Holiday | null>(null);
  const [streaks, setStreaks] = useState<Record<string, number>>({});
  const [streakConfigs, setStreakConfigs] = useState<StreakConfig[]>([]);
  const [llmQuota, setLlmQuota] = useState<LlmQuota | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [, setTick] = useState(0);

  // LLM 남은 횟수: 화면에 들어올 때마다 갱신 (배너 표시용)
  useFocusEffect(
    useCallback(() => {
      fetchLlmQuota().then(setLlmQuota).catch(() => {});
    }, [])
  );

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setupNotificationChannel();
    requestNotificationPermissions();
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setErrorMessage(null);
    try {
      const { routines: fetchedRoutines, completions: fetchedCompletions, holiday: fetchedHoliday } =
        await fetchTodayRoutines(userId);
      setRoutines(fetchedRoutines);
      setHoliday(fetchedHoliday);
      const completionMap: Record<string, RoutineCompletion> = {};
      const inputMap: Record<string, string> = {};
      for (const completion of fetchedCompletions) {
        completionMap[completion.routine_id] = completion;
        if (completion.tracking_value !== null) {
          inputMap[completion.routine_id] = String(completion.tracking_value);
        }
      }
      setCompletions(completionMap);
      setTrackingInputs(inputMap);

      const streakResult = await fetchStreaks(fetchedRoutines, formatLocalDate(new Date()));
      setStreaks(streakResult);

      syncSlotAlarms(userId).catch(() => {});
      syncReminderAlarm(userId).catch(() => {});
    } catch (err) {
      setErrorMessage('루틴을 불러오지 못했어요. 다시 시도해주세요.');
    }
  }, [userId]);

  useEffect(() => {
    fetchStreakConfigs().then(setStreakConfigs).catch(() => {});
  }, []);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  async function refreshStreaks() {
    const streakResult = await fetchStreaks(routines, formatLocalDate(new Date()));
    setStreaks(streakResult);
  }

  async function handleToggleCheck(routine: Routine) {
    const existing = completions[routine.id] ?? null;
    try {
      const result = await toggleCheckCompletion(routine.id, existing?.id ?? null);
      setCompletions((prev) => {
        const next = { ...prev };
        if (result) {
          next[routine.id] = result;
        } else {
          delete next[routine.id];
        }
        return next;
      });
      await refreshStreaks();
      if (userId) syncReminderAlarm(userId).catch(() => {});
    } catch (err) {
      setErrorMessage('체크 처리에 실패했어요.');
    }
  }

  async function handleSkipToday(routine: Routine) {
    try {
      await skipRoutineToday(routine.id);
      setRoutines((prev) => prev.filter((r) => r.id !== routine.id));
      if (userId) syncReminderAlarm(userId).catch(() => {});
    } catch (err) {
      setErrorMessage('삭제에 실패했어요.');
    }
  }

  async function handleSaveTracking(routine: Routine) {
    const raw = trackingInputs[routine.id];
    const value = Number(raw);
    if (!raw || Number.isNaN(value)) return;

    const existing = completions[routine.id] ?? null;
    try {
      const result = await saveTrackingValue(routine.id, existing?.id ?? null, value);
      setCompletions((prev) => ({ ...prev, [routine.id]: result }));
      await refreshStreaks();
      if (userId) syncReminderAlarm(userId).catch(() => {});
    } catch (err) {
      setErrorMessage('기록 저장에 실패했어요.');
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
      <View style={styles.header}>
        <Text style={styles.title}>오늘</Text>
        <Text style={styles.email}>{session?.user.email}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.headerButtonsScroll}
        contentContainerStyle={styles.headerButtonsContent}>
        <Pressable style={styles.presetButton} onPress={() => router.push('/videos')}>
          <Text style={styles.presetButtonText}>🎬 영상</Text>
        </Pressable>
        <Pressable
          style={styles.presetButton}
          onPress={() => router.push({ pathname: '/diary-form', params: { date: formatLocalDate(new Date()) } })}>
          <Text style={styles.presetButtonText}>📔 일기</Text>
        </Pressable>
        <Pressable style={styles.presetButton} onPress={() => router.push('/presets')}>
          <Text style={styles.presetButtonText}>📦 모음집</Text>
        </Pressable>
        <Pressable style={styles.presetButton} onPress={() => router.push('/my-routines')}>
          <Text style={styles.presetButtonText}>📋 내 루틴</Text>
        </Pressable>
        <Pressable style={styles.addButton} onPress={() => router.push('/routine-form')}>
          <Text style={styles.addButtonText}>+ 루틴 추가</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.viewModeTabs}>
        <Pressable
          style={[styles.viewModeTab, viewMode === 'list' && styles.viewModeTabActive]}
          onPress={() => setViewMode('list')}>
          <Text style={[styles.viewModeTabText, viewMode === 'list' && styles.viewModeTabTextActive]}>리스트</Text>
        </Pressable>
        <Pressable
          style={[styles.viewModeTab, viewMode === 'timeline' && styles.viewModeTabActive]}
          onPress={() => setViewMode('timeline')}>
          <Text style={[styles.viewModeTabText, viewMode === 'timeline' && styles.viewModeTabTextActive]}>
            타임라인
          </Text>
        </Pressable>
      </View>

      <Pressable style={styles.llmBanner} onPress={() => router.push('/llm-input')}>
        <Text style={styles.llmBannerText}>✨ 말로 루틴 추가하기</Text>
        {llmQuota && (
          <Text style={styles.llmBannerCount}>
            남은 {llmQuota.remaining}/{llmQuota.limit}회
          </Text>
        )}
      </Pressable>

      {holiday && (
        <View style={styles.holidayBanner}>
          <Text style={styles.holidayBannerText}>🎉 오늘은 {holiday.name}이에요</Text>
        </View>
      )}

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {viewMode === 'timeline' ? (
        <TimelineView
          routines={routines}
          completions={completions}
          onToggleCheck={handleToggleCheck}
          onEdit={(routine) => router.push({ pathname: '/routine-form', params: { id: routine.id } })}
        />
      ) : (
      <FlatList
        style={styles.list}
        contentContainerStyle={routines.length === 0 ? styles.emptyContainer : undefined}
        data={routines}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={<Text style={styles.emptyText}>오늘 할 루틴이 없어요</Text>}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const completion = completions[item.id];
          const isDone = Boolean(completion);
          const isNow = isHappeningNow(item);
          const streakDays = streaks[item.id] ?? 0;
          const streakEmoji = emojiForStreak(streakDays, streakConfigs);

          return (
            <Swipeable
              overshootRight={false}
              renderRightActions={() => (
                <Pressable style={styles.deleteAction} onPress={() => handleSkipToday(item)}>
                  <Text style={styles.deleteActionText}>오늘 삭제</Text>
                </Pressable>
              )}>
              <View style={[styles.row, isNow && styles.rowHighlighted]}>
                <Text style={styles.time}>{timeLabel(item)}</Text>
                <View style={styles.rowMain}>
                  <View style={styles.titleLine}>
                    <View style={item.is_required ? styles.requiredHighlight : undefined}>
                      <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]}>{item.title}</Text>
                    </View>
                    {streakEmoji && (
                      <Text style={styles.streakBadge}>
                        {streakEmoji} {streakDays}일
                      </Text>
                    )}
                  </View>

                  {item.block_type === 'tracking' ? (
                    <View style={styles.trackingRow}>
                      <TextInput
                        style={styles.trackingInput}
                        keyboardType="numeric"
                        value={trackingInputs[item.id] ?? ''}
                        onChangeText={(text) =>
                          setTrackingInputs((prev) => ({ ...prev, [item.id]: text }))
                        }
                        placeholder="0"
                      />
                      <Text style={styles.unit}>{item.tracking_unit}</Text>
                      <Pressable style={styles.saveButton} onPress={() => handleSaveTracking(item)}>
                        <Text style={styles.saveButtonText}>저장</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {item.video_id && (
                  <Pressable
                    style={styles.playButton}
                    onPress={() => router.push({ pathname: '/video-player', params: { id: item.video_id! } })}>
                    <Text style={styles.playButtonText}>▶</Text>
                  </Pressable>
                )}

                {item.block_type === 'check' && (
                  <Pressable
                    style={[styles.checkbox, isDone && styles.checkboxDone]}
                    onPress={() => handleToggleCheck(item)}>
                    {isDone && <Text style={styles.checkmark}>✓</Text>}
                  </Pressable>
                )}

                <Pressable
                  style={styles.editButton}
                  onPress={() => router.push({ pathname: '/routine-form', params: { id: item.id } })}>
                  <Text style={styles.editButtonText}>✎</Text>
                </Pressable>
              </View>
            </Swipeable>
          );
        }}
      />
      )}

      {routines.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            오늘 완료 {routines.filter((r) => completions[r.id]).length}/{routines.length} (
            {Math.round((routines.filter((r) => completions[r.id]).length / routines.length) * 100)}%)
          </Text>
          {(() => {
            const bestStreak = Math.max(0, ...Object.values(streaks));
            const bestEmoji = emojiForStreak(bestStreak, streakConfigs);
            return bestEmoji ? (
              <Text style={styles.summaryText}>
                최고 기록 {bestEmoji} {bestStreak}일
              </Text>
            ) : null;
          })()}
        </View>
      )}

      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>로그아웃</Text>
      </Pressable>
    </KeyboardAvoidingView>
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
  llmBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#7C5CFC',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  llmBannerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  llmBannerCount: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerButtonsScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  headerButtonsContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  presetButton: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetButtonText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  email: {
    marginTop: 4,
    fontSize: 13,
    opacity: 0.6,
  },
  viewModeTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 92, 252, 0.08)',
    padding: 4,
    gap: 4,
  },
  viewModeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewModeTabActive: {
    backgroundColor: '#7C5CFC',
  },
  viewModeTabText: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.6,
  },
  viewModeTabTextActive: {
    color: '#fff',
    opacity: 1,
  },
  error: {
    color: '#FF6B6B',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  holidayBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#FF6B6B',
  },
  holidayBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 10,
  },
  rowHighlighted: {
    borderColor: '#7C5CFC',
  },
  time: {
    width: 78,
    fontSize: 12,
    opacity: 0.6,
  },
  rowMain: {
    flex: 1,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  rowTitle: {
    fontSize: 15,
  },
  rowTitleDone: {
    opacity: 0.4,
    textDecorationLine: 'line-through',
  },
  requiredHighlight: {
    backgroundColor: 'rgba(255, 107, 107, 0.35)',
    borderRadius: 3,
    paddingHorizontal: 4,
    transform: [{ rotate: '-1.5deg' }],
  },
  streakBadge: {
    fontSize: 12,
    opacity: 0.7,
  },
  trackingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  trackingInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    width: 60,
  },
  unit: {
    fontSize: 13,
    opacity: 0.7,
  },
  saveButton: {
    marginLeft: 'auto',
    backgroundColor: '#7C5CFC',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#7C5CFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#7C5CFC',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  editButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  editButtonText: {
    fontSize: 15,
    opacity: 0.5,
  },
  playButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  playButtonText: {
    fontSize: 14,
    color: '#7C5CFC',
  },
  deleteAction: {
    backgroundColor: '#FF6B6B',
    justifyContent: 'center',
    alignItems: 'center',
    width: 84,
    borderRadius: 10,
    marginVertical: 2,
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: 13,
    opacity: 0.7,
  },
  signOutButton: {
    alignSelf: 'center',
    marginVertical: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  signOutText: {
    color: '#FF6B6B',
  },
});
