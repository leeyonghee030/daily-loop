import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, fontDisplay, fontMono, textMuted } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation } from '@/lib/language';
import { useAuth } from '@/lib/auth-context';
import {
  fetchStats,
  routineMatchesDayCategory,
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
function CompletionRing({
  ratio,
  accent,
  styles,
}: {
  ratio: number;
  accent: string;
  styles: ReturnType<typeof createStyles>;
}) {
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
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  // 오늘 탭이 화면을 연 뒤 백그라운드로 이 같은 쿼리 키(['stats', userId])를 미리 받아두므로
  // (queryClient.prefetchQuery), 보통 오늘 탭을 먼저 보고 통계 탭으로 넘어오면 캐시가 이미
  // 채워져 있어서 로딩이 아예 안 보인다. 캐시가 전혀 없는 진짜 최초 진입일 때만 아래에서 스피너.
  const summaryQuery = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => fetchStats(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(summaryQuery.refetch, !!userId);
  const summary = summaryQuery.data ?? null;

  const [showHidden, setShowHidden] = useState(false);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [dayCategory, setDayCategory] = useState<'all' | 'weekday' | 'weekend'>('all');
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

  // isError를 안 보고 !summary만 봤더니, 조회가 실패해도(예: 로그인 직후 userId 준비 전
  // 타이밍에 잘못된 요청이 나가 서버 에러가 난 경우) data가 계속 없는 상태로 남아서 스피너가
  // 영원히 도는 것처럼 보이는 버그가 있었음 — 실패했을 땐 안내+재시도 버튼을 따로 보여준다
  if (summaryQuery.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{t('stats.errorLoad')}</Text>
        <AnimatedPressable onPress={() => summaryQuery.refetch()} style={styles.retryButton}>
          <Text style={[styles.retryButtonText, { color: accent }]}>{t('stats.retry')}</Text>
        </AnimatedPressable>
      </View>
    );
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
        <Text style={styles.emptyText}>{t('stats.emptyNoRecords')}</Text>
      </View>
    );
  }

  function renderRoutine({ item }: { item: RoutineStats }) {
    const rate = rateValue(item.completedCount, item.scheduledCount);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.routine.title}</Text>
          <AnimatedPressable onPress={() => handleToggleHide(item, true)} hitSlop={8}>
            <Text style={styles.hideLink}>{t('stats.hide')}</Text>
          </AnimatedPressable>
        </View>

        <View style={styles.streakChipRow}>
          <View style={styles.streakChip}>
            <Text style={styles.streakChipLabel}>{t('stats.currentStreak')}</Text>
            <Text style={styles.streakChipValue}>
              {item.currentStreak}
              {t('today.daySuffix')}
            </Text>
          </View>
          <View style={styles.streakChip}>
            <Text style={styles.streakChipLabel}>{t('stats.bestStreak')}</Text>
            <Text style={styles.streakChipValue}>
              {item.bestStreak}
              {t('today.daySuffix')}
            </Text>
          </View>
        </View>

        <View style={styles.rateRow}>
          <Text style={styles.cardLabel}>{t('stats.allTimeRate')}</Text>
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

  const periodSummary = summary[period];
  const categorySummary = dayCategory === 'all' ? periodSummary : periodSummary[dayCategory];

  // 평일/주말 카테고리를 고르면 목록도 그 카테고리에 해당하는 루틴만 남긴다
  // (매일=둘 다, 평일만/주말만=한쪽만, 1회성/커스텀=실제 요일 기준)
  const filteredRoutines =
    dayCategory === 'all' ? summary.routines : summary.routines.filter((r) => routineMatchesDayCategory(r.routine, dayCategory));
  const filteredHiddenRoutines =
    dayCategory === 'all'
      ? summary.hiddenRoutines
      : summary.hiddenRoutines.filter((r) => routineMatchesDayCategory(r.routine, dayCategory));

  return (
    <View style={styles.container}>
      <View style={styles.periodTabs}>
        <AnimatedPressable
          style={[styles.periodTab, period === 'weekly' && styles.periodTabActive]}
          onPress={() => setPeriod('weekly')}>
          <Text style={[styles.periodTabText, period === 'weekly' && styles.periodTabTextActive]}>{t('stats.weekly')}</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.periodTab, period === 'monthly' && styles.periodTabActive]}
          onPress={() => setPeriod('monthly')}>
          <Text style={[styles.periodTabText, period === 'monthly' && styles.periodTabTextActive]}>{t('stats.monthly')}</Text>
        </AnimatedPressable>
      </View>

      <ShadowCard style={styles.summaryCardOuter} contentStyle={styles.summaryCard}>
        <View style={styles.summaryTextCol}>
          <Text style={styles.summaryLabel}>
            {period === 'weekly' ? t('stats.last7DaysRate') : t('stats.last30DaysRate')}
          </Text>
          <Text style={styles.summaryHeadline}>
            {categorySummary.completed}/{categorySummary.scheduled} {t('stats.completedSuffix')}
          </Text>
        </View>
        <CompletionRing
          ratio={rateValue(categorySummary.completed, categorySummary.scheduled)}
          accent={accent}
          styles={styles}
        />
      </ShadowCard>

      <View style={styles.categoryTabs}>
        <AnimatedPressable
          style={[styles.categoryTab, dayCategory === 'all' && styles.categoryTabActive]}
          onPress={() => setDayCategory('all')}>
          <Text style={[styles.categoryTabText, dayCategory === 'all' && styles.categoryTabTextActive]}>
            {t('stats.categoryAll')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.categoryTab, dayCategory === 'weekday' && styles.categoryTabActive]}
          onPress={() => setDayCategory('weekday')}>
          <Text style={[styles.categoryTabText, dayCategory === 'weekday' && styles.categoryTabTextActive]}>
            {t('stats.categoryWeekday')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.categoryTab, dayCategory === 'weekend' && styles.categoryTabActive]}
          onPress={() => setDayCategory('weekend')}>
          <Text style={[styles.categoryTabText, dayCategory === 'weekend' && styles.categoryTabTextActive]}>
            {t('stats.categoryWeekend')}
          </Text>
        </AnimatedPressable>
      </View>

      {showSummaryNote && <Text style={styles.summaryNote}>{t('stats.summaryNote')}</Text>}

      <FlatList
        style={styles.list}
        data={filteredRoutines}
        keyExtractor={(item) => item.routine.id}
        renderItem={renderRoutine}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          summary.routines.length > 0 ? (
            <Text style={styles.emptyText}>{t('stats.emptyCategoryNoRoutines')}</Text>
          ) : summary.hiddenRoutines.length > 0 ? (
            <Text style={styles.emptyText}>{t('stats.emptyAllHidden')}</Text>
          ) : (
            <Text style={styles.emptyText}>
              {t('stats.emptyNoActiveRoutines')}
              {'\n'}
              {t('stats.summaryNote')}
            </Text>
          )
        }
      />

      {filteredHiddenRoutines.length > 0 && (
        <View style={styles.hiddenSection}>
          <AnimatedPressable onPress={() => setShowHidden((v) => !v)}>
            <Text style={styles.hiddenToggle}>
              {showHidden
                ? t('stats.hiddenCollapse')
                : `${t('stats.hiddenExpandPrefix')}${filteredHiddenRoutines.length}${t('stats.hiddenExpandSuffix')}`}
            </Text>
          </AnimatedPressable>
          {showHidden && (
            <ScrollView style={styles.hiddenList}>
              {filteredHiddenRoutines.map((item) => (
                <View key={item.routine.id} style={styles.hiddenRow}>
                  <Text style={styles.hiddenRowTitle}>{item.routine.title}</Text>
                  <AnimatedPressable onPress={() => handleToggleHide(item, false)} hitSlop={8}>
                    <Text style={styles.unhideLink}>{t('stats.unhide')}</Text>
                  </AnimatedPressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
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
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
  emptyText: {
    opacity: 0.5,
    textAlign: 'center',
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
    marginBottom: 10,
  },
  categoryTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.08)',
    padding: 4,
    gap: 4,
  },
  categoryTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: cardRadius,
    alignItems: 'center',
  },
  categoryTabActive: {
    backgroundColor: accent,
  },
  categoryTabText: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.6,
  },
  categoryTabTextActive: {
    color: '#fff',
    opacity: 1,
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
    fontSize: 18 + fontKorean.sizeAdjust,
    lineHeight: 24 + fontKorean.sizeAdjust,
    fontWeight: '600',
    fontFamily: fontKorean.fontFamily,
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
}
