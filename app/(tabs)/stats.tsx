import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { accent, border, cardRadius, fontDisplay, fontMono, textMuted } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  emojiForStreak,
  fetchStats,
  fetchStreakConfigs,
  setHideFromStats,
  type RoutineStats,
  type StatsSummary,
} from '@/lib/routines';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';

function formatRate(completed: number, scheduled: number): string {
  if (scheduled === 0) return '-';
  return `${Math.round((completed / scheduled) * 100)}%`;
}

function rateValue(completed: number, scheduled: number): number {
  if (scheduled === 0) return 0;
  return Math.min(1, completed / scheduled);
}

const SUMMARY_NOTE_SEEN_KEY = 'stats_summary_note_seen';
const RING_SIZE = 76;
const RING_STROKE = 8;

// 이번 주/월 수행률을 도넛 링으로 보여준다 — 퍼센트 숫자는 SVG 밖에서 절대위치로 겹쳐서
// 일반 Text로 그리므로(목업과 동일한 방식) 폰트를 자유롭게 지정할 수 있다
function CompletionRing({ ratio }: { ratio: number }) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <View style={styles.ringWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          stroke={border}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          stroke={accent}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          strokeLinecap="round"
          rotation={-90}
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      <Text style={styles.ringPct}>{Math.round(ratio * 100)}%</Text>
    </View>
  );
}

export default function StatsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  // 오늘 탭이 화면을 연 뒤 백그라운드로 이 같은 쿼리 키(['stats', userId])를 미리 받아두므로
  // (queryClient.prefetchQuery), 보통 오늘 탭을 먼저 보고 통계 탭으로 넘어오면 캐시가 이미
  // 채워져 있어서 로딩이 아예 안 보인다. 캐시가 전혀 없는 진짜 최초 진입일 때만 아래에서 스피너.
  const summaryQuery = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => fetchStats(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(summaryQuery.refetch);
  const summary = summaryQuery.data ?? null;

  // 오늘 탭과 같은 쿼리 키를 쓰기 때문에 이미 오늘 탭에서 받아온 값이 있으면 재요청 없이 공유됨
  const streakConfigsQuery = useQuery({
    queryKey: ['streak-configs'],
    queryFn: fetchStreakConfigs,
    staleTime: 60 * 60 * 1000,
  });
  const streakConfigs = streakConfigsQuery.data ?? [];

  const [showHidden, setShowHidden] = useState(false);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [showSummaryNote, setShowSummaryNote] = useState(false);

  // "삭제된 루틴 기록도 포함됩니다" 안내는 계속 떠 있으면 거슬리니 최초 1회만 보여주고,
  // 그다음부터는 (해당될 때만) 아래 빈 목록 안내 문구에 녹여서 보여준다
  useEffect(() => {
    (async () => {
      const seen = await AsyncStorage.getItem(SUMMARY_NOTE_SEEN_KEY);
      if (seen) return;
      setShowSummaryNote(true);
      await AsyncStorage.setItem(SUMMARY_NOTE_SEEN_KEY, 'true');
    })();
  }, []);

  async function handleToggleHide(item: RoutineStats, hide: boolean) {
    // 즉각적인 반응을 위해 먼저 화면만 낙관적으로 바꾸고, 최근 7일/30일 수행률까지 정확히
    // 맞추기 위해 서버 반영 뒤 다시 불러온다 (숨긴 루틴은 이 수치 계산에서도 빠져야 하므로)
    queryClient.setQueryData(['stats', userId], (prev?: StatsSummary) => {
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
    } finally {
      summaryQuery.refetch();
    }
  }

  if (!summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  // 지금 살아있는 루틴 카드가 하나도 없어도(전부 삭제됐어도), 삭제 전 기록이 남아있으면
  // 이번주/이번달 요약은 계속 보여줘야 함 — 카드 목록만 없다고 통계 전체를 빈 화면 처리하면 안 됨
  const hasAnyData =
    summary.routines.length > 0 ||
    summary.hiddenRoutines.length > 0 ||
    summary.weekly.scheduled > 0 ||
    summary.monthly.scheduled > 0;
  if (!hasAnyData) {
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

      <ShadowCard style={styles.summaryCardOuter} contentStyle={styles.summaryCard}>
        <View style={styles.summaryTextCol}>
          <Text style={styles.summaryLabel}>{period === 'weekly' ? '최근 7일 수행률' : '최근 30일 수행률'}</Text>
          <Text style={styles.summaryHeadline}>
            {summary[period].completed}/{summary[period].scheduled} 완료
          </Text>
        </View>
        <CompletionRing ratio={rateValue(summary[period].completed, summary[period].scheduled)} />
      </ShadowCard>
      {showSummaryNote && (
        <Text style={styles.summaryNote}>삭제된 루틴의 기록도 삭제 전 날짜까지는 위 수행률에 포함돼 있어요</Text>
      )}

      <FlatList
        style={styles.list}
        data={summary.routines}
        keyExtractor={(item) => item.routine.id}
        renderItem={renderRoutine}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          summary.hiddenRoutines.length > 0 ? (
            <Text style={styles.emptyText}>표시할 통계가 없어요 (전부 숨김 상태)</Text>
          ) : (
            <Text style={styles.emptyText}>
              진행 중인 루틴이 없어요{'\n'}삭제된 루틴의 기록도 삭제 전 날짜까지는 위 수행률에 포함돼 있어요
            </Text>
          )
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
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.08)',
    padding: 4,
    gap: 4,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: cardRadius,
    alignItems: 'center',
  },
  periodTabActive: {
    backgroundColor: accent,
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
  summaryCardOuter: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  summaryCard: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  summaryTextCol: {
    flex: 1,
  },
  summaryLabel: {
    fontFamily: fontMono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: textMuted,
  },
  summaryHeadline: {
    fontFamily: fontDisplay,
    fontSize: 19,
    marginTop: 6,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  ringPct: {
    position: 'absolute',
    fontFamily: fontDisplay,
    fontSize: 17,
  },
  summaryNote: {
    fontSize: 11,
    opacity: 0.4,
    textAlign: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
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
    borderColor: border,
    borderRadius: cardRadius,
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
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.08)',
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
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: cardRadius,
    backgroundColor: accent,
  },
  hiddenSection: {
    borderTopWidth: 1,
    borderTopColor: border,
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
    borderTopColor: border,
  },
  hiddenRowTitle: {
    fontSize: 13,
    opacity: 0.6,
  },
  unhideLink: {
    fontSize: 12,
    color: accent,
    fontWeight: '600',
  },
});
