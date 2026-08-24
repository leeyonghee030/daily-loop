import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  emojiForStreak,
  fetchStats,
  fetchStreakConfigs,
  setHideFromStats,
  type RoutineStats,
  type StatsSummary,
  type StreakConfig,
} from '@/lib/routines';

function formatRate(completed: number, scheduled: number): string {
  if (scheduled === 0) return '-';
  return `${Math.round((completed / scheduled) * 100)}%`;
}

function rateValue(completed: number, scheduled: number): number {
  if (scheduled === 0) return 0;
  return Math.min(1, completed / scheduled);
}

export default function StatsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [streakConfigs, setStreakConfigs] = useState<StreakConfig[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');

  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const [statsResult, configs] = await Promise.all([fetchStats(userId), fetchStreakConfigs()]);
      setSummary(statsResult);
      setStreakConfigs(configs);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // isLoading 스피너 없이 통계만 조용히 새로고침 (숨기기 토글 직후, 화면이 깜빡이지 않게)
  async function refreshSummary() {
    if (!userId) return;
    try {
      setSummary(await fetchStats(userId));
    } catch {
      // 무시 — 다음 포커스 때 다시 시도됨
    }
  }

  async function handleToggleHide(item: RoutineStats, hide: boolean) {
    // 즉각적인 반응을 위해 먼저 화면만 낙관적으로 바꾸고, 최근 7일/30일 수행률까지 정확히
    // 맞추기 위해 서버 반영 뒤 다시 불러온다 (숨긴 루틴은 이 수치 계산에서도 빠져야 하므로)
    setSummary((prev) => {
      if (!prev) return prev;
      if (hide) {
        return {
          ...prev,
          routines: prev.routines.filter((r) => r.routine.id !== item.routine.id),
          hiddenRoutines: [...prev.hiddenRoutines, item],
        };
      }
      return {
        ...prev,
        routines: [...prev.routines, item],
        hiddenRoutines: prev.hiddenRoutines.filter((r) => r.routine.id !== item.routine.id),
      };
    });
    try {
      await setHideFromStats(item.routine.id, hide);
      await refreshSummary();
    } catch {
      await refreshSummary();
    }
  }

  if (isLoading || !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (summary.routines.length === 0 && summary.hiddenRoutines.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>아직 기록이 없어요, 루틴을 먼저 체크해보세요</Text>
      </View>
    );
  }

  function renderRoutine({ item }: { item: RoutineStats }) {
    const currentEmoji = emojiForStreak(item.currentStreak, streakConfigs);
    const bestEmoji = emojiForStreak(item.bestStreak, streakConfigs);
    const rate = rateValue(item.completedCount, item.scheduledCount);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.routine.title}</Text>
          <Pressable onPress={() => handleToggleHide(item, true)} hitSlop={8}>
            <Text style={styles.hideLink}>숨기기</Text>
          </Pressable>
        </View>

        <View style={styles.streakChipRow}>
          <View style={styles.streakChip}>
            <Text style={styles.streakChipLabel}>현재 스트릭</Text>
            <Text style={styles.streakChipValue}>
              {currentEmoji ? `${currentEmoji} ` : ''}
              {item.currentStreak}일
            </Text>
          </View>
          <View style={styles.streakChip}>
            <Text style={styles.streakChipLabel}>최고 스트릭</Text>
            <Text style={styles.streakChipValue}>
              {bestEmoji ? `${bestEmoji} ` : ''}
              {item.bestStreak}일
            </Text>
          </View>
        </View>

        <View style={styles.rateRow}>
          <Text style={styles.cardLabel}>전체 기간 수행률</Text>
          <Text style={styles.cardValue}>
            {formatRate(item.completedCount, item.scheduledCount)} ({item.completedCount}/{item.scheduledCount})
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${rate * 100}%` }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>통계</Text>
      </View>

      <View style={styles.periodTabs}>
        <Pressable
          style={[styles.periodTab, period === 'weekly' && styles.periodTabActive]}
          onPress={() => setPeriod('weekly')}>
          <Text style={[styles.periodTabText, period === 'weekly' && styles.periodTabTextActive]}>주간</Text>
        </Pressable>
        <Pressable
          style={[styles.periodTab, period === 'monthly' && styles.periodTabActive]}
          onPress={() => setPeriod('monthly')}>
          <Text style={[styles.periodTabText, period === 'monthly' && styles.periodTabTextActive]}>월별</Text>
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>{period === 'weekly' ? '최근 7일 수행률' : '최근 30일 수행률'}</Text>
        <Text style={styles.summaryValue}>
          {formatRate(summary[period].completed, summary[period].scheduled)}
        </Text>
        <Text style={styles.summarySub}>
          {summary[period].completed}/{summary[period].scheduled} 완료
        </Text>
      </View>

      <FlatList
        style={styles.list}
        data={summary.routines}
        keyExtractor={(item) => item.routine.id}
        renderItem={renderRoutine}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          summary.hiddenRoutines.length > 0 ? (
            <Text style={styles.emptyText}>표시할 통계가 없어요 (전부 숨김 상태)</Text>
          ) : null
        }
      />

      {summary.hiddenRoutines.length > 0 && (
        <View style={styles.hiddenSection}>
          <Pressable onPress={() => setShowHidden((v) => !v)}>
            <Text style={styles.hiddenToggle}>
              {showHidden ? '숨긴 항목 접기 ▲' : `숨긴 항목 ${summary.hiddenRoutines.length}개 보기 ▼`}
            </Text>
          </Pressable>
          {showHidden && (
            <ScrollView style={styles.hiddenList}>
              {summary.hiddenRoutines.map((item) => (
                <View key={item.routine.id} style={styles.hiddenRow}>
                  <Text style={styles.hiddenRowTitle}>{item.routine.title}</Text>
                  <Pressable onPress={() => handleToggleHide(item, false)} hitSlop={8}>
                    <Text style={styles.unhideLink}>다시 보이기</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    opacity: 0.5,
    textAlign: 'center',
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  periodTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 92, 252, 0.08)',
    padding: 4,
    gap: 4,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  periodTabActive: {
    backgroundColor: '#7C5CFC',
  },
  periodTabText: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.6,
  },
  periodTabTextActive: {
    color: '#fff',
    opacity: 1,
  },
  summaryCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#7C5CFC',
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.85,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 4,
  },
  summarySub: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.85,
    marginTop: 2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  hideLink: {
    fontSize: 12,
    opacity: 0.4,
  },
  streakChipRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  streakChip: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 92, 252, 0.08)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  streakChipLabel: {
    fontSize: 11,
    opacity: 0.6,
    marginBottom: 4,
  },
  streakChipValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardLabel: {
    fontSize: 13,
    opacity: 0.6,
  },
  cardValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(124, 92, 252, 0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#7C5CFC',
  },
  hiddenSection: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingHorizontal: 20,
  },
  hiddenList: {
    maxHeight: 160,
  },
  hiddenToggle: {
    fontSize: 13,
    opacity: 0.5,
    textAlign: 'center',
    paddingVertical: 10,
  },
  hiddenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  hiddenRowTitle: {
    fontSize: 13,
    opacity: 0.6,
  },
  unhideLink: {
    fontSize: 12,
    color: '#7C5CFC',
    fontWeight: '600',
  },
});
