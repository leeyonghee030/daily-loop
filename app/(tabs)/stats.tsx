import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  emojiForStreak,
  fetchStats,
  fetchStreakConfigs,
  type RoutineStats,
  type StatsSummary,
  type StreakConfig,
} from '@/lib/routines';

function formatRate(completed: number, scheduled: number): string {
  if (scheduled === 0) return '-';
  return `${Math.round((completed / scheduled) * 100)}%`;
}

export default function StatsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [streakConfigs, setStreakConfigs] = useState<StreakConfig[]>([]);

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

  if (isLoading || !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (summary.routines.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>아직 기록이 없어요, 루틴을 먼저 체크해보세요</Text>
      </View>
    );
  }

  function renderRoutine({ item }: { item: RoutineStats }) {
    const currentEmoji = emojiForStreak(item.currentStreak, streakConfigs);
    const bestEmoji = emojiForStreak(item.bestStreak, streakConfigs);
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{item.routine.title}</Text>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>현재 스트릭</Text>
          <Text style={styles.cardValue}>
            {currentEmoji ? `${currentEmoji} ` : ''}
            {item.currentStreak}일
          </Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>역대 최고 스트릭</Text>
          <Text style={styles.cardValue}>
            {bestEmoji ? `${bestEmoji} ` : ''}
            {item.bestStreak}일
          </Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>전체 기간 수행률</Text>
          <Text style={styles.cardValue}>
            {formatRate(item.completedCount, item.scheduledCount)} ({item.completedCount}/{item.scheduledCount})
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>통계</Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>최근 7일 수행률</Text>
        <Text style={styles.summaryValue}>{formatRate(summary.recentCompleted, summary.recentScheduled)}</Text>
        <Text style={styles.summarySub}>
          {summary.recentCompleted}/{summary.recentScheduled} 완료
        </Text>
      </View>

      <FlatList
        style={styles.list}
        data={summary.routines}
        keyExtractor={(item) => item.routine.id}
        renderItem={renderRoutine}
        contentContainerStyle={styles.listContent}
      />
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
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  cardRow: {
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
});
