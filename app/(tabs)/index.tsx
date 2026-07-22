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
  StyleSheet,
  TextInput,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
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
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(interval);
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
    } catch (err) {
      setErrorMessage('체크 처리에 실패했어요.');
    }
  }

  async function handleSkipToday(routine: Routine) {
    try {
      await skipRoutineToday(routine.id);
      setRoutines((prev) => prev.filter((r) => r.id !== routine.id));
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
        <View style={styles.headerTop}>
          <Text style={styles.title}>오늘</Text>
          <View style={styles.headerButtons}>
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
            <Pressable style={styles.addButton} onPress={() => router.push('/routine-form')}>
              <Text style={styles.addButtonText}>+ 루틴 추가</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.email}>{session?.user.email}</Text>
      </View>

      {holiday && (
        <View style={styles.holidayBanner}>
          <Text style={styles.holidayBannerText}>🎉 오늘은 {holiday.name}이에요</Text>
        </View>
      )}

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

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
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerButtons: {
    flexDirection: 'row',
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
