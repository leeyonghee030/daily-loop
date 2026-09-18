import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  type DimensionValue,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, dangerMuted, fontMono, textMuted, withAlpha } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
import { useAuth } from '@/lib/auth-context';
import { fetchLlmQuota } from '@/lib/llm';
import { purgeOldDeletedPresets } from '@/lib/presets';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
import { purgeOldDeletedCategories } from '@/lib/videos';
import {
  requestNotificationPermissions,
  setupNotificationChannel,
  syncReminderAlarm,
  syncSlotAlarms,
} from '@/lib/notifications';
import {
  effectiveTimeRange,
  fetchStats,
  fetchTodayRoutines,
  formatLocalDate,
  saveTrackingValue,
  skipRoutineToday,
  slotTimeLabel,
  toggleCheckCompletion,
  SLOT_LABEL_KEYS,
  type Routine,
  type RoutineCompletion,
} from '@/lib/routines';

const PURGE_LAST_RUN_KEY = 'deleted_routines_purge_last_run_date';

// 소프트 삭제된 지 2주 지난 모음집/카테고리를 완전히 정리 — 앱 켤 때마다 하루 한 번만 조용히 실행.
// 루틴은 완료기록이 영구 보존돼야 해서 대상에서 제외(절대 완전삭제 안 함, 소프트 삭제 상태로 계속 남음)
async function runDailyPurgeIfNeeded(userId: string): Promise<void> {
  const today = formatLocalDate(new Date());
  const lastRun = await AsyncStorage.getItem(PURGE_LAST_RUN_KEY);
  if (lastRun === today) return;
  try {
    await purgeOldDeletedPresets(userId);
    await purgeOldDeletedCategories(userId);
  } catch {
    // 실패해도 조용히 무시 — 다음에 앱 열 때 다시 시도됨
  }
  await AsyncStorage.setItem(PURGE_LAST_RUN_KEY, today);
}

function formatTime(time: string): string {
  return time.slice(0, 5);
}

function timeLabel(routine: Routine, t: (key: TranslationKey) => string): string {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    const start = routine.scheduled_time_start;
    // 시간 안 걸리고 그 순간에 체크만 하는 타입("8시 기상" 등)은 시작=끝을 그대로 보여주면
    // 범위처럼 보이니 시각 하나만 표시
    if (routine.is_instant) return formatTime(start);
    const end = routine.scheduled_time_end;
    // 시계로는 24:00을 고를 수 없어 자정 종료는 00:00으로 저장되므로, 화면에는 24:00으로 보여줌
    const endLabel = end <= start ? '24:00' : formatTime(end);
    return `${formatTime(start)}-${endLabel}`;
  }
  if (routine.slots) return t(SLOT_LABEL_KEYS[routine.slots.slot_type]);
  return '';
}

const HOUR_HEIGHT = 56;
const ROW_HEIGHT = 34;
const EXPANDED_ROW_GAP = 4;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// 시계로는 24:00을 고를 수 없어서 자정에 끝나는 루틴은 끝 시각이 00:00으로 저장됨 —
// 그대로 두면 끝이 시작보다 이른 것처럼 계산돼서(예: 23:00~00:00) 타임라인에 안 보이거나
// 강조가 안 되는 문제가 생기므로, 끝이 시작보다 작거나 같으면 자정(24:00)으로 취급한다.
// 단, 순간 체크 타입(is_instant)은 시작=끝을 "0분짜리"로 일부러 저장한 것이라 이 규칙에서 제외
// (안 그러면 "8시-8시"가 다음날 자정까지 이어지는 24시간짜리 일정으로 잘못 계산됨)
function endMinutes(range: { start: string; end: string }, isInstant = false): number {
  const startMin = toMinutes(range.start);
  if (isInstant) return startMin;
  const endMin = toMinutes(range.end);
  return endMin <= startMin ? endMin + 24 * 60 : endMin;
}

function isNowWithinRange(range: { start: string; end: string }, isInstant = false): boolean {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= toMinutes(range.start) && nowMinutes < endMinutes(range, isInstant);
}

type TimedBlock = { id: string; top: number; height: number };

// 같은 시간대(또는 겹치는 시간대)에 여러 루틴이 있으면 겹쳐 그리지 않고 옆으로 나란히 배치한다.
// clusterId는 "같이 겹치는 무리"를 묶어서 식별하는 용도(5개 넘을 때 더보기 화살표 판단에 사용)
function assignColumns(
  items: TimedBlock[]
): Map<string, { col: number; totalCols: number; clusterId: number }> {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const result = new Map<string, { col: number; totalCols: number; clusterId: number }>();
  let cluster: TimedBlock[] = [];
  let clusterMaxBottom = -Infinity;
  let clusterId = 0;

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
      result.set(item.id, { col, totalCols: -1, clusterId }); // totalCols는 클러스터 끝나고 일괄 채움
    }
    const totalCols = colEnds.length;
    for (const item of cluster) {
      const prev = result.get(item.id)!;
      result.set(item.id, { ...prev, totalCols });
    }
    clusterId++;
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

type TimedEntry = { routine: Routine; range: { start: string; end: string }; isExact: boolean; isInstant: boolean };
type TimelineBlock = { key: string; top: number; height: number; start: string; isExact: boolean; items: TimedEntry[] };

const SLOT_HINT_DISMISSED_KEY = 'timeline_slot_hint_dismissed';
const SLOT_HINT_LAST_SHOWN_KEY = 'timeline_slot_hint_last_shown_date';
// 트래킹 입력창을 키보드 위로 올릴 때 미리 얹어두는 안전 여백 — 안드로이드는 키보드가 뜬
// 직후(자동완성 줄 없음)와 첫 글자를 입력해 자동완성 줄이 붙은 직후 사이에 실제 키보드 높이가
// 다시 커진다. 매번 "그때그때 실제 높이"로만 보정하면 이 성장분만큼 한 번 더 스크롤이 튀어서
// "숫자를 처음 입력할 때만 한 번 튀는" 것처럼 보인다 — 처음 계산할 때부터 이 여백을 미리
// 얹어두면, 나중에 진짜로 키보드가 커져도 이미 그만큼 여유를 두고 있어서 추가로 스크롤할 필요가
// 없어진다(대부분의 안드로이드 자동완성 줄 높이가 이 값 이내라 가정한 여유값)
const KEYBOARD_GROWTH_SAFETY_MARGIN = 56;

// 타임라인 뷰: 시간축에 루틴을 세로로 배치해서 하루 일정을 한눈에 보여줌
function TimelineView({
  routines,
  completions,
  onToggleCheck,
  onEdit,
  repositionToken,
}: {
  routines: Routine[];
  completions: Record<string, RoutineCompletion>;
  onToggleCheck: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
  repositionToken: number;
}) {
  const [showSlotHint, setShowSlotHint] = useState(false);
  const [dontShowSlotHintAgain, setDontShowSlotHintAgain] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<number>>(new Set());
  const accent = useAccentColor();
  const { t } = useTranslation();
  const koreanFont = useKoreanFont();
  const timelineStyles = useMemo(() => createTimelineStyles(accent, koreanFont), [accent, koreanFont]);

  const timed = routines
    .map((routine) => {
      const isExact = Boolean(routine.scheduled_time_start && routine.scheduled_time_end);
      // 이 항목이 "그 순간 하나만" 체크하는 타입인지 — 루틴 자체가 시각 체크(is_instant)이거나,
      // 슬롯 기반이면서 그 슬롯이 체크형으로 설정돼 있을 때. 아니면(정확한 시간 슬롯) 실제
      // 슬롯 시간대(예: 12:00~13:00) 전체 길이만큼 블록을 그린다
      const isInstant = isExact ? routine.is_instant : Boolean(routine.slots?.is_instant);
      return {
        routine,
        range: effectiveTimeRange(routine),
        isExact,
        isInstant,
      };
    })
    .filter((r): r is TimedEntry => r.range !== null);

  // 같은 슬롯(예: 아침)에 루틴이 여러 개 몰리면 옆으로 계속 쪼개져 좁아지는 대신
  // 한 블록 안에 세로로 쌓아서 보여준다 — 정확한 시각 루틴은 각자 실제 시간대로 따로 배치
  const groups = new Map<string, TimedEntry[]>();
  for (const entry of timed) {
    const groupKey = entry.isExact ? `exact-${entry.routine.id}` : `slot-${entry.range.start}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(entry);
  }
  const hasSlotCollision = Array.from(groups.values()).some((items) => !items[0].isExact && items.length > 1);

  // 같은 슬롯에 2개 이상 몰린 날에만, 하루 한 번(또는 "다시 안 보기" 선택 시 영구히) 순서 변경 안내를 띄운다
  useEffect(() => {
    if (!hasSlotCollision) return;
    let cancelled = false;
    (async () => {
      const dismissed = await AsyncStorage.getItem(SLOT_HINT_DISMISSED_KEY);
      if (cancelled || dismissed === 'true') return;
      const lastShown = await AsyncStorage.getItem(SLOT_HINT_LAST_SHOWN_KEY);
      if (cancelled || lastShown === formatLocalDate(new Date())) return;
      setShowSlotHint(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasSlotCollision]);

  async function closeSlotHint() {
    setShowSlotHint(false);
    if (dontShowSlotHintAgain) {
      await AsyncStorage.setItem(SLOT_HINT_DISMISSED_KEY, 'true');
    } else {
      await AsyncStorage.setItem(SLOT_HINT_LAST_SHOWN_KEY, formatLocalDate(new Date()));
    }
  }

  const startHours = timed.map((r) => Math.floor(toMinutes(r.range.start) / 60));
  const minHour = Math.max(0, Math.min(6, ...startHours));
  const maxHour = Math.min(
    24,
    Math.max(
      22,
      ...timed.map((r) =>
        r.isInstant ? Math.floor(toMinutes(r.range.start) / 60) + 1 : Math.ceil(endMinutes(r.range, false) / 60)
      )
    )
  );
  const totalHeight = (maxHour - minHour) * HOUR_HEIGHT;

  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowMinutes >= minHour * 60 && nowMinutes <= maxHour * 60;
  const nowTop = (nowMinutes - minHour * 60) * (HOUR_HEIGHT / 60);

  // 같은 시간대에 여러 개 몰려도 쌓지 않고 각자 블록으로 만들어서, 아래 컬럼 배치 로직이 옆으로 나란히 놓는다
  const blocks: TimelineBlock[] = timed.map((entry) => {
    const { routine, range, isExact, isInstant } = entry;
    const key = isExact ? `exact-${routine.id}` : `slot-${routine.id}`;
    const top = (toMinutes(range.start) - minHour * 60) * (HOUR_HEIGHT / 60);
    const rawHeight = isInstant ? 0 : (endMinutes(range, false) - toMinutes(range.start)) * (HOUR_HEIGHT / 60);
    const height = isInstant ? 34 : Math.max(rawHeight, 34);
    return { key, top, height, start: range.start, isExact, items: [entry] };
  });
  const columns = assignColumns(blocks.map((b) => ({ id: b.key, top: b.top, height: b.height })));
  const clusterBlocks = new Map<number, TimelineBlock[]>();
  for (const block of blocks) {
    const clusterId = columns.get(block.key)?.clusterId ?? -1;
    if (!clusterBlocks.has(clusterId)) clusterBlocks.set(clusterId, []);
    clusterBlocks.get(clusterId)!.push(block);
  }

  // 화면을 처음 열 때(마운트), 그리고 다른 탭 갔다가 돌아왔을 때(repositionToken 증가) 매번
  // 지금 시각 위치로 다시 스크롤한다. 예전엔 ScrollView의 onContentSizeChange(콘텐츠 크기가
  // 바뀔 때만 호출됨)에 기대서 "최초 1회만" 스크롤했는데, 탭을 갔다 왔을 때 내용이 안 바뀌었으면
  // onContentSizeChange 자체가 다시 안 불려서 재정렬이 안 되는 문제가 있었음 — repositionToken은
  // 데이터 내용과 무관하게 "돌아왔다"는 사실 자체로 바뀌는 값이라 이 문제가 없다
  useEffect(() => {
    if (timed.length === 0) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const earliestTop = Math.min(...blocks.map((b) => b.top));
      const target = showNowLine ? Math.max(0, nowTop - HOUR_HEIGHT) : earliestTop;
      scrollRef.current?.scrollTo({ y: Math.max(0, target - 12), animated: false });
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositionToken]);

  if (timed.length === 0) {
    return (
      <View style={timelineStyles.emptyContainer}>
        <Text style={timelineStyles.emptyText}>{t('today.timelineEmpty')}</Text>
      </View>
    );
  }

  // 지금 시간대에 해당하는 블록은 색/밑줄로 눈에 띄게 강조.
  // "더보기"로 펼친 블록(expanded)은 실제 시간 위치와 무관하게 겹쳐 그려지므로, 아래 깔린
  // 다른 글자가 비치지 않도록 불투명한 카드로 그 자리를 가리고 글자색도 카드에 맞춰 고정한다
  function renderBlock(
    block: TimelineBlock,
    pos: {
      top: number;
      height: number;
      left: DimensionValue;
      width: DimensionValue;
      showTime: boolean;
      expanded?: boolean;
    }
  ) {
    const isNowBlock = isNowWithinRange(block.items[0].range, block.items[0].isInstant);
    return (
      <View
        key={block.key}
        style={[
          timelineStyles.block,
          isNowBlock && timelineStyles.blockNow,
          pos.expanded && timelineStyles.blockExpanded,
          { top: pos.top, height: pos.height, left: pos.left, width: pos.width },
        ]}>
        {block.items.map(({ routine }, index) => {
          const completion = completions[routine.id];
          const isDone = Boolean(completion);
          return (
            <View key={routine.id} style={[timelineStyles.blockRow, isDone && timelineStyles.blockRowDone]}>
              <AnimatedPressable style={timelineStyles.blockContent} onPress={() => onEdit(routine)}>
                {pos.showTime && index === 0 && (
                  <Text style={[timelineStyles.blockTime, pos.expanded && timelineStyles.blockTextExpanded]}>
                    {formatTime(block.start)}
                  </Text>
                )}
                <Text
                  style={[
                    timelineStyles.blockTitle,
                    isDone && timelineStyles.blockTitleDone,
                    isNowBlock && timelineStyles.blockTitleNow,
                    pos.expanded && timelineStyles.blockTextExpanded,
                  ]}
                  numberOfLines={1}>
                  {routine.title}
                </Text>
              </AnimatedPressable>
              {routine.block_type === 'check' ? (
                <AnimatedPressable
                  hitSlop={8}
                  style={[timelineStyles.blockCheckbox, isDone && timelineStyles.blockCheckboxDone]}
                  onPress={() => onToggleCheck(routine)}>
                  {isDone && <Text style={timelineStyles.blockCheckmark}>✓</Text>}
                </AnimatedPressable>
              ) : pos.showTime ? (
                <Text
                  style={[timelineStyles.blockTrackingValue, pos.expanded && timelineStyles.blockTextExpanded]}>
                  {completion?.tracking_value ?? '-'} {routine.tracking_unit}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View style={timelineStyles.wrapper}>
      {showSlotHint && (
        <View style={timelineStyles.hintBanner}>
          <Text style={timelineStyles.hintText}>
            같은 시간대에 루틴이 여러 개 있으면, 나열되는 순서는 &quot;내 루틴&quot; 탭에서 드래그로 바꿀 수 있어요.
          </Text>
          <View style={timelineStyles.hintFooter}>
            <AnimatedPressable
              style={timelineStyles.hintCheckboxRow}
              onPress={() => setDontShowSlotHintAgain((v) => !v)}
              hitSlop={6}>
              <View style={[timelineStyles.hintCheckbox, dontShowSlotHintAgain && timelineStyles.hintCheckboxChecked]}>
                {dontShowSlotHintAgain && <Text style={timelineStyles.hintCheckmark}>✓</Text>}
              </View>
              <Text style={timelineStyles.hintCheckboxLabel}>{t('today.dontShowAgain')}</Text>
            </AnimatedPressable>
            <AnimatedPressable onPress={closeSlotHint} hitSlop={6}>
              <Text style={timelineStyles.hintCloseText}>{t('today.close')}</Text>
            </AnimatedPressable>
          </View>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={timelineStyles.container}
        contentContainerStyle={{ height: totalHeight + 20 }}
        onScrollBeginDrag={() => {
          if (expandedClusters.size > 0) setExpandedClusters(new Set());
        }}>
      {hours.map((hour) => (
        <Fragment key={hour}>
          <View style={[timelineStyles.hourLine, { top: (hour - minHour) * HOUR_HEIGHT }]} />
          <View style={[timelineStyles.hourLabelWrap, { top: (hour - minHour) * HOUR_HEIGHT - 7 }]}>
            <Text style={timelineStyles.hourLabel}>{String(hour).padStart(2, '0')}:00</Text>
          </View>
        </Fragment>
      ))}

      {showNowLine && <View style={[timelineStyles.nowLine, { top: nowTop - 1 }]} pointerEvents="none" />}

      <View style={timelineStyles.blocksArea}>
        {Array.from(clusterBlocks.entries()).map(([clusterId, clusterItems]) => {
          const totalCols = columns.get(clusterItems[0].key)?.totalCols ?? 1;
          const sortedItems = [...clusterItems].sort(
            (a, b) => (columns.get(a.key)?.col ?? 0) - (columns.get(b.key)?.col ?? 0)
          );

          // 안 겹치면 그대로 한 칸 전체를 써서, 실제 시간 길이대로 배치
          if (totalCols <= 1) {
            const block = sortedItems[0];
            return renderBlock(block, { top: block.top, height: block.height, left: '0%', width: '100%', showTime: true });
          }

          const clusterTop = Math.min(...clusterItems.map((b) => b.top));
          const isExpanded = expandedClusters.has(clusterId);

          // 겹치면 기본은 1개 + "더보기" 버튼만 보여주고, 누르면 위아래로 1개씩 전부 펼쳐서 보여준다
          // 이때도 각 블록의 실제 소요 시간(block.height)을 유지 — 강제로 작은 고정 높이로 뭉개지 않는다
          if (!isExpanded) {
            const first = sortedItems[0];
            const hiddenCount = sortedItems.length - 1;
            return (
              <Fragment key={clusterId}>
                {renderBlock(first, { top: clusterTop, height: first.height, left: '0%', width: '80%', showTime: false })}
                <AnimatedPressable
                  style={[
                    timelineStyles.block,
                    timelineStyles.moreBlock,
                    { top: clusterTop, height: first.height, left: '84%', width: '16%' },
                  ]}
                  onPress={() => setExpandedClusters((prev) => new Set(prev).add(clusterId))}>
                  <Text style={timelineStyles.moreBlockText}>+{hiddenCount}</Text>
                </AnimatedPressable>
              </Fragment>
            );
          }

          // 펼친 목록은 각자 실제 소요시간(예: 2시간짜리 슬롯이면 112px)만큼 칸을 그대로 쓰면
          // 글자 한 줄 아래로 빈 공간이 크게 남아서 3개만 펼쳐도 화면이 길게 늘어나 보임 —
          // 어차피 펼친 상태에선 "목록"으로 보여주는 거지 실제 길이를 나타낼 필요가 없으니,
          // 전부 같은 작은 높이로 보여준다. 다 같은 슬롯 시작 시각이라 시간 표시는 중복이니
          // 아예 안 보여주고, 칸 사이에 일정한 여백을 둔다.
          // 이 목록은 실제 시간 위치와 무관한 자리라, 밑에 원래 그 시각에 있던 다른 블록이
          // 깔려있을 수 있음 — 칸 사이 여백 틈으로 그 블록의 테두리 색이 살짝 비쳐 보이던
          // 버그가 있었음(2026-09-17). 목록 전체 범위를 불투명한 배경판 하나로 먼저 깔아서
          // 그 뒤에 뭐가 있든 절대 안 비치게 막는다
          const expandedTotalHeight =
            sortedItems.length * ROW_HEIGHT + (sortedItems.length - 1) * EXPANDED_ROW_GAP;
          return (
            <Fragment key={clusterId}>
              <View
                pointerEvents="none"
                style={[
                  timelineStyles.block,
                  timelineStyles.blockExpanded,
                  { top: clusterTop, height: expandedTotalHeight, left: '0%', width: '100%' },
                ]}
              />
              {sortedItems.map((block, index) => {
                const offsetTop = clusterTop + index * (ROW_HEIGHT + EXPANDED_ROW_GAP);
                return renderBlock(block, {
                  top: offsetTop,
                  height: ROW_HEIGHT,
                  left: '0%',
                  width: '100%',
                  showTime: false,
                  expanded: true,
                });
              })}
            </Fragment>
          );
        })}
      </View>
      </ScrollView>
    </View>
  );
}

function createTimelineStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  hintBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.1)',
    gap: 8,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 17,
  },
  hintFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hintCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintCheckbox: {
    width: 16,
    height: 16,
    borderRadius: cardRadius,
    borderWidth: 1.5,
    borderColor: accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintCheckboxChecked: {
    backgroundColor: accent,
  },
  hintCheckmark: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  hintCheckboxLabel: {
    fontSize: 11,
    opacity: 0.6,
  },
  hintCloseText: {
    fontSize: 12,
    color: accent,
    fontWeight: '600',
  },
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
    // 시간 라벨 구역(0~69, blocksArea와 동일 너비)엔 선을 안 그어서 라벨을 안 가리게 함
    position: 'absolute',
    left: 69,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(26,26,26,0.1)',
    justifyContent: 'center',
  },
  hourLabelWrap: {
    position: 'absolute',
    left: 4,
  },
  hourLabel: {
    fontSize: 10,
    opacity: 0.4,
  },
  blocksArea: {
    position: 'absolute',
    left: 69,
    right: 0,
    top: 0,
    bottom: 0,
  },
  block: {
    position: 'absolute',
    backgroundColor: 'rgba(169, 196, 224, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: accent,
    borderRadius: cardRadius,
    overflow: 'hidden',
  },
  moreBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(169, 196, 224, 0.2)',
  },
  moreBlockText: {
    fontSize: 11,
    fontWeight: '700',
    color: accent,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: withAlpha(accent, 0.35),
    zIndex: 5,
  },
  blockNow: {
    backgroundColor: 'rgba(255, 152, 0, 0.18)',
    borderLeftColor: '#FF9800',
  },
  // "더보기"로 펼쳤을 때만 적용 — 실제 시간 위치와 무관하게 겹쳐 그려지는 자리라, 밑에 깔린
  // 다른 글자가 비쳐 보이지 않도록 불투명하게 가려주고 다른 블록들보다 위에 그려지게 한다
  blockExpanded: {
    backgroundColor: '#EAF1F9',
    zIndex: 10,
    elevation: 4,
  },
  blockTextExpanded: {
    color: '#1A1A1A',
  },
  // 커스텀 폰트("동글 폰트")는 굵은 글씨 파일이 없어서 fontWeight를 주면 RN이 시스템 폰트로
  // 대체해버림(=사용자가 고른 폰트가 안 먹히는 원인) — 대신 색으로만 강조해서 폰트를 유지한다
  blockTitleNow: {
    color: '#E65100',
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    paddingRight: 4,
  },
  blockRowDone: {
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
    fontFamily: fontMono,
  },
  blockTitle: {
    flex: 1,
    fontSize: 14 + fontKorean.sizeAdjust,
    lineHeight: 19 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  blockTitleDone: {
    textDecorationLine: 'line-through',
  },
  blockCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockCheckboxDone: {
    backgroundColor: accent,
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
}

type ListRowProps = {
  item: Routine;
  isNow: boolean;
  flat: boolean;
  completion: RoutineCompletion | undefined;
  isEditingTracking: boolean;
  trackingInputValue: string;
  styles: ReturnType<typeof createStyles>;
  swipeRefsRef: MutableRefObject<Record<string, Swipeable | null>>;
  swipeAutoCloseTimersRef: MutableRefObject<Record<string, ReturnType<typeof setTimeout>>>;
  trackingInputRefsRef: MutableRefObject<Record<string, TextInput | null>>;
  onEdit: (routine: Routine) => void;
  onToggleCheck: (routine: Routine) => void;
  onSkipToday: (routine: Routine) => void;
  onCancelTracking: (routine: Routine) => void;
  onStartEditTracking: (routine: Routine) => void;
  onCloseEditTracking: (routineId: string) => void;
  onSaveTracking: (routine: Routine) => void;
  onChangeTrackingInput: (routineId: string, text: string) => void;
  onFocusTracking: (routineId: string) => void;
  onBlurTracking: (routineId: string) => void;
  onPlayVideo: (videoId: string) => void;
};

// 오늘 탭 리스트의 한 행. React.memo로 감싸서, 위에서 넘어오는 props(completion/streakDays 등)가
// 그 루틴 자신의 것과 안 바뀌었으면 리렌더링을 건너뛴다 — 체크박스 하나를 눌러도 리스트 전체
// (스와이프/애니메이션까지 포함한 모든 행)가 매번 다시 그려지며 렉이 걸리던 문제의 핵심 수정.
// 이 메모가 실제로 효과 있으려면 props로 받는 함수들이 부모에서 매번 새로 만들어지지 않고
// 항상 같은 참조를 유지해야 하므로(TodayScreen의 handleToggleCheck 등 참고), 여기서 새로
// 클로저를 만들 필요가 있는 것(onPress 래핑 등)은 이 컴포넌트 내부에서만 한다
const ListRow = memo(function ListRow({
  item,
  isNow,
  flat,
  completion,
  isEditingTracking,
  trackingInputValue,
  styles,
  swipeRefsRef,
  swipeAutoCloseTimersRef,
  trackingInputRefsRef,
  onEdit,
  onToggleCheck,
  onSkipToday,
  onCancelTracking,
  onStartEditTracking,
  onCloseEditTracking,
  onSaveTracking,
  onChangeTrackingInput,
  onFocusTracking,
  onBlurTracking,
  onPlayVideo,
}: ListRowProps) {
  const { t } = useTranslation();
  const isDone = Boolean(completion);

  return (
    <Swipeable
      ref={(instance) => {
        swipeRefsRef.current[item.id] = instance;
      }}
      onSwipeableOpen={() => {
        clearTimeout(swipeAutoCloseTimersRef.current[item.id]);
        swipeAutoCloseTimersRef.current[item.id] = setTimeout(() => {
          swipeRefsRef.current[item.id]?.close();
        }, 2000);
      }}
      onSwipeableClose={() => {
        clearTimeout(swipeAutoCloseTimersRef.current[item.id]);
        delete swipeAutoCloseTimersRef.current[item.id];
      }}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.swipeActionsRow}>
          <AnimatedPressable style={styles.editAction} onPress={() => onEdit(item)}>
            <Text style={styles.editActionText}>{t('today.edit')}</Text>
          </AnimatedPressable>
          {item.block_type === 'tracking' && isDone && !isEditingTracking && (
            <AnimatedPressable style={styles.cancelTrackingAction} onPress={() => onCancelTracking(item)}>
              <Text style={styles.editActionText}>{t('today.cancelRecord')}</Text>
            </AnimatedPressable>
          )}
          <AnimatedPressable style={styles.deleteAction} onPress={() => onSkipToday(item)}>
            <Text style={styles.deleteActionText}>{t('today.skipToday')}</Text>
          </AnimatedPressable>
        </View>
      )}>
      <View style={[styles.row, isNow && !flat && styles.rowHighlighted, flat && styles.rowFlat]}>
        <View style={styles.timeColumn}>
          <Text style={styles.time} numberOfLines={1}>
            {timeLabel(item, t)}
          </Text>
          {item.slots && (
            <Text style={styles.timeSub} numberOfLines={1}>
              {slotTimeLabel(item.slots)}
            </Text>
          )}
        </View>
        <View style={styles.rowMain}>
          <AnimatedPressable style={styles.titleLine} onPress={() => onEdit(item)}>
            <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]} numberOfLines={1}>
              {item.title}
            </Text>
          </AnimatedPressable>
          {item.is_required && !isDone && <View style={styles.requiredBar} />}
        </View>

        {item.video_id && (
          <AnimatedPressable style={styles.playButton} onPress={() => onPlayVideo(item.video_id!)}>
            <Text style={styles.playButtonText}>▶</Text>
          </AnimatedPressable>
        )}

        {item.block_type === 'check' && (
          <View style={styles.actionSlot}>
            <AnimatedPressable
              style={[styles.checkbox, isDone && styles.checkboxDone]}
              onPress={() => onToggleCheck(item)}>
              {isDone && <Text style={styles.checkmark}>✓</Text>}
            </AnimatedPressable>
          </View>
        )}

        {item.block_type === 'tracking' ? (
          isDone && !isEditingTracking ? (
            <View style={styles.actionSlot}>
              <AnimatedPressable onPress={() => onStartEditTracking(item)}>
                <Text style={styles.trackingDoneBadge} numberOfLines={1}>
                  ✓ {completion?.tracking_value} {item.tracking_unit}
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            <>
              <View style={styles.trackingRow}>
                <TextInput
                  ref={(instance) => {
                    trackingInputRefsRef.current[item.id] = instance;
                  }}
                  style={styles.trackingInput}
                  keyboardType="numeric"
                  value={trackingInputValue}
                  onChangeText={(text) => onChangeTrackingInput(item.id, text)}
                  onFocus={() => onFocusTracking(item.id)}
                  onBlur={() => onBlurTracking(item.id)}
                  placeholder="0"
                  autoFocus={isDone}
                />
                <Text style={styles.unit}>{item.tracking_unit}</Text>
                {isDone && (
                  <AnimatedPressable style={styles.cancelTrackingButton} onPress={() => onCloseEditTracking(item.id)}>
                    <Text style={styles.cancelTrackingButtonText}>{t('today.close')}</Text>
                  </AnimatedPressable>
                )}
              </View>
              <View style={styles.actionSlot}>
                <AnimatedPressable style={styles.saveButton} onPress={() => onSaveTracking(item)}>
                  <Text style={styles.saveButtonText}>{t('today.save')}</Text>
                </AnimatedPressable>
              </View>
            </>
          )
        ) : null}
      </View>
    </Swipeable>
  );
});

export default function TodayScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  // 이미 오늘 기록이 있는 트래킹 루틴은 기본으로 "기록됨" 표시만 보여주고, 이 Set에 들어있는
  // 동안만 입력창을 다시 펼친다 — "수정"을 눌러야 입력창이 나타나고 "저장"하면 다시 접혀서
  // 표시가 바뀌는 게 눈에 보여야, 저장이 실제로 됐는지 확인할 수 있다는 피드백을 반영
  const [editingTrackingIds, setEditingTrackingIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [, setTick] = useState(0);
  // 자정을 넘기면 이 값이 바뀌면서 아래 쿼리의 key도 같이 바뀌어 자동으로 새 날짜 기준으로
  // 다시 불러온다 — 예전엔 "날짜 바뀐 걸 감지하면 수동으로 load() 호출"을 직접 구현했었음
  const [todayDateStr, setTodayDateStr] = useState(() => formatLocalDate(new Date()));
  const listScrollRef = useRef<ScrollView>(null);
  // 각 행이 실제로 레이아웃된 뒤 그 y좌표를 기록해둔다(행 높이가 서로 달라 미리 계산 불가) —
  // 타임라인처럼 ScrollView + scrollTo를 써서, FlatList의 scrollToIndex/키 재생성 방식에서
  // 나던 깜빡임(리스트를 통째로 다시 만드는 과정에서 생기던 재렌더링) 없이 매끄럽게 옮긴다
  const rowLayoutsRef = useRef<Record<string, number>>({});
  // 트래킹 입력창에 포커스된 루틴 id — 키보드가 완전히 올라온 뒤(keyboardDidShow) 그 시점에
  // 맞춰 다시 한번 스크롤하기 위해 기억해둔다(아래 scrollRowIntoView 설명 참고)
  const focusedTrackingIdRef = useRef<string | null>(null);
  // 트래킹 입력창이 리스트 아래쪽에 있으면, 그 아래에 스크롤할 콘텐츠 자체가 모자라서 아무리
  // scrollTo를 불러도 이미 스크롤 끝(바닥)이라 더 못 올라가는 문제가 있었음(2026-09-17) —
  // 키보드가 떠 있는 동안만 그 키보드 높이만큼 리스트 맨 아래에 빈 여백을 깔아서, 어떤 행이든
  // 항상 화면 위쪽까지 끌어올릴 수 있는 여지를 만들어준다
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // 지금 스크롤이 얼마나 내려가 있는지 — 트래킹 입력창을 키보드 위로 올릴 때, "얼마나 더
  // 내려야(스크롤해야) 하는지"를 실제 화면 좌표 기준으로 계산하기 위해 필요하다
  const listScrollYRef = useRef(0);
  // 트래킹 입력창(TextInput) 인스턴스 — 포커스됐을 때 measureInWindow로 화면상 실제 위치를
  // 재서, 키보드에 가려지는 만큼만 정확히 스크롤한다(아래 scrollTrackingInputAboveKeyboard 참고)
  const trackingInputRefsRef = useRef<Record<string, TextInput | null>>({});
  // keyboardDidShow 보정을 잠깐 미뤄뒀다가 한 번만 실행하기 위한 타이머(아래 useEffect 참고) —
  // 안드로이드에서 숫자 키보드가 뜬 직후 타이핑을 시작하면 자동완성 줄이 붙으면서 키보드
  // 높이가 살짝 다시 바뀌어 keyboardDidShow가 한 번 더 발생하는 경우가 있어서 필요하다
  const keyboardScrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 스와이프로 연 행을 액션(수정/기록삭제) 후, 또는 아무 것도 안 누르고 방치했을 때, 또는
  // 다른 탭 갔다 돌아왔을 때 직접 닫기 위한 인스턴스 저장소
  const swipeRefsRef = useRef<Record<string, Swipeable | null>>({});
  // 스와이프를 열어두고 방치하면 1.5초 뒤 자동으로 닫기 위한 타이머 저장소
  const swipeAutoCloseTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 수정 화면에 갔다가 돌아왔을 때 "지금 시각" 위치가 아니라 방금 스와이프했던 그 루틴이
  // 잘 보이는 위치로 스크롤하기 위해 기억해둔다 — 아래 repositionToken 효과에서 소비하고 지운다
  const pendingFocusRoutineIdRef = useRef<string | null>(null);
  // 캘린더/통계 탭 갔다가 돌아왔을 때 리스트/타임라인을 다시 "지금 시각" 위치로 맞추는 신호.
  // routines 값 자체가 바뀌는 걸 신호로 썼더니, react-query가 내용이 똑같으면 참조를 그대로
  // 재사용하는(structural sharing) 최적화 때문에 "돌아왔는데 내용이 안 바뀐 경우"엔 재조회를
  // 해도 routines 참조가 안 바뀌어서 재정렬이 아예 실행이 안 되는 버그가 있었음 — 데이터 내용과
  // 무관하게 "탭에 돌아왔다"는 사실 자체를 별도 신호(숫자를 하나씩 올림)로 만들어서 해결
  const [repositionToken, setRepositionToken] = useState(0);
  // 다른 탭에 갔다가 돌아왔을 때, 그동안 열려있던 스와이프가 있으면 같이 닫는다
  const bumpRepositionToken = useCallback(() => {
    setRepositionToken((t) => t + 1);
    Object.values(swipeRefsRef.current).forEach((ref) => ref?.close());
  }, []);
  useRefetchOnFocus(bumpRepositionToken);

  // 오늘 예정 루틴 + 완료기록 + 공휴일. staleTime이 0(query-client.ts 기본값)이라 포커스마다
  // 자동으로 오래된 데이터 취급되고, useRefetchOnFocus가 실제 재요청을 트리거한다.
  // isLoading은 "캐시된 데이터가 전혀 없을 때만" true라서, 예전에 손으로 만들던
  // "최초 1회만 스피너" 로직이 필요 없어졌다.
  const todayQuery = useQuery({
    queryKey: ['today-routines', userId, todayDateStr],
    queryFn: () => fetchTodayRoutines(userId!),
    enabled: !!userId,
  });
  useRefetchOnFocus(todayQuery.refetch, !!userId);

  // 원래 load()가 새로 불러오기 시작할 때 에러 메시지를 지우고, 실패하면 채워 넣던 것과 동일 —
  // react-query로 옮기면서 이 부분이 빠져서 조회 실패 시 안내가 하나도 안 뜨는 회귀가 있었음.
  // isFetching과 isError를 각자 다른 effect에서 따로 보면, 두 번째 시도도 또 실패했을 때
  // isError 값 자체는 true→true로 "안 바뀐" 것처럼 보여서 effect가 다시 안 실행되고, 메시지가
  // 지워진 채로 안 돌아오는 버그가 있었음 — 하나의 effect에서 같이 보면 isFetching이
  // true→false로 바뀌는 시점마다 무조건 다시 검사해서 이 문제가 없어진다
  useEffect(() => {
    if (todayQuery.isFetching) {
      setErrorMessage(null);
    } else if (todayQuery.isError) {
      console.error('오늘 루틴 로딩 실패:', todayQuery.error);
      setErrorMessage(t('today.errorLoad'));
    }
  }, [todayQuery.isFetching, todayQuery.isError, todayQuery.error]);

  // 체크/삭제/기록저장 실패 등으로 뜨는 에러 배너는 1초 뒤 자동으로 사라진다(예전엔 다른 탭에
  // 갔다 오기 전까진 계속 남아있었음)
  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => setErrorMessage(null), 2000);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  const routines = useMemo(() => todayQuery.data?.routines ?? [], [todayQuery.data]);
  const holiday = todayQuery.data?.holiday ?? null;

  const completions = useMemo(() => {
    const map: Record<string, RoutineCompletion> = {};
    for (const c of todayQuery.data?.completions ?? []) map[c.routine_id] = c;
    return map;
  }, [todayQuery.data]);

  // 완료기록이 새로 도착할 때마다(포커스마다 재조회 포함) 입력창을 그 값 기준으로 다시 채운다 —
  // 기존 load() 방식과 동일한 동작(입력하다 만 값은 다음 새로고침에 덮어써짐)
  useEffect(() => {
    const inputMap: Record<string, string> = {};
    for (const c of todayQuery.data?.completions ?? []) {
      if (c.tracking_value !== null) inputMap[c.routine_id] = String(c.tracking_value);
    }
    setTrackingInputs(inputMap);
  }, [todayQuery.data]);

  // LLM 남은 횟수: 화면에 들어올 때마다 갱신(배너 표시용)
  const llmQuotaQuery = useQuery({
    queryKey: ['llm-quota', userId],
    queryFn: fetchLlmQuota,
    enabled: !!userId,
  });
  useRefetchOnFocus(llmQuotaQuery.refetch, !!userId);
  const llmQuota = llmQuotaQuery.data ?? null;

  // 1분마다 다시 렌더링해서 "지금" 강조선을 갱신하고, 날짜가 자정을 넘어간 게 감지되면
  // todayDateStr을 갱신한다(위 쿼리들의 key가 바뀌면서 자동으로 새 날짜로 다시 불러와짐)
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      const currentDate = formatLocalDate(new Date());
      setTodayDateStr((prev) => (prev === currentDate ? prev : currentDate));
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // 알림 권한 요청/채널 설정, 하루 1회 정리, 통계 탭용 백그라운드 사전 캐싱은 오늘 목록 표시와
  // 무관한 작업들이라, 오늘 목록이 처음 뜬 뒤(최초 성공 시점)로 순서를 미루고 한 번만 실행한다.
  // stats 쿼리를 여기서 미리 받아두면(prefetchQuery) 통계 탭이 같은 쿼리 키로 캐시를 그대로
  // 재사용해서 로딩 없이 바로 뜬다 — 예전에 따로 만든 lib/stats-cache.ts 캐시 모듈을 대체함
  const secondaryStartupDoneRef = useRef(false);
  useEffect(() => {
    if (!todayQuery.isSuccess || secondaryStartupDoneRef.current || !userId) return;
    secondaryStartupDoneRef.current = true;
    setupNotificationChannel();
    requestNotificationPermissions();
    runDailyPurgeIfNeeded(userId).catch(() => {});
    queryClient.prefetchQuery({ queryKey: ['stats', userId], queryFn: () => fetchStats(userId) });
  }, [todayQuery.isSuccess, userId, queryClient]);

  // 알림 동기화는 예전 load()와 동일하게 매번 성공적으로 다시 불러올 때마다 실행
  useEffect(() => {
    if (userId && todayQuery.data) {
      syncSlotAlarms(userId).catch(() => {});
      syncReminderAlarm(userId).catch(() => {});
    }
  }, [userId, todayQuery.data]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await todayQuery.refetch();
    setIsRefreshing(false);
  }

  // 리스트뷰도 타임라인처럼 화면을 열면 지금 시각 근처 루틴이 바로 보이게 자동 스크롤한다.
  // FlatList의 scrollToIndex(+숨겼다 보여주기/키로 강제 재생성)는 여러 번 시도해봐도 깜빡임이
  // 남아서, 타임라인이 이미 매끄럽게 동작하는 것과 똑같은 방식(ScrollView + scrollTo)으로
  // 바꿨다 — 리스트를 다시 만들 필요 없이, 같은 ScrollView 인스턴스를 그대로 둔 채 위치만 옮긴다
  function computeNowIndex(list: Routine[]): number {
    if (list.length === 0) return -1;
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    let idx = list.findIndex((r) => {
      const range = effectiveTimeRange(r);
      return range ? isNowWithinRange(range, r.is_instant) : false;
    });
    if (idx === -1) {
      // 지금 진행 중인 루틴이 없으면 다음으로 다가올(지금 이후 가장 가까운 시각) 루틴을 기준으로 삼는다
      idx = list.findIndex((r) => {
        const range = effectiveTimeRange(r);
        return range ? toMinutes(range.start) >= nowMinutes : false;
      });
    }
    return idx;
  }

  // 앱을 맨 처음 열어서 리스트가 이 순간 막 생겨나는 시점엔, 이 함수가 불리는 때(routines가
  // 막 채워진 직후)에 아직 각 행의 onLayout이 한 번도 안 불려서 rowLayoutsRef가 비어있다 —
  // 예전엔 이때 그냥 조용히 포기하고 ScrollView의 onContentSizeChange가 나중에 다시 불러주길
  // 기다렸는데, 그 콜백이 기대만큼 안정적으로 다시 불리지 않아서 "최초 진입 시엔 위치가 전혀
  // 안 맞는" 문제가 있었음 — 대신 레이아웃이 아직 없으면 짧게(60ms) 재시도를 몇 번 걸어서
  // 레이아웃이 잡힐 때까지 스스로 기다리게 한다(탭을 갔다 왔을 때는 이미 레이아웃이 있어서
  // 바로 성공하니 체감상 지연은 없음)
  function scrollListToNow(attemptsLeft = 6) {
    // ⚠️ 트래킹 입력창에 포커스가 있는 동안(키보드가 떠 있는 동안)은 절대 이 "지금 시각"
    // 위치로 재정렬하면 안 된다 — 원인을 오래 못 찾았던 "숫자 입력하면 튀는" 버그의 진짜
    // 정체가 바로 이 함수였다: 이 ScrollView엔 onContentSizeChange={scrollListToNow}가 걸려
    // 있어서, 키보드가 뜨거나(우리가 까는 spacer 높이 변경) 커질 때마다(자동완성 줄이 붙어
    // keyboardDidChangeFrame이 옴) 콘텐츠 크기가 바뀌고, 그때마다 이 함수가 같이 불려서
    // 트래킹 입력창과는 전혀 무관한 "지금 시각" 루틴 위치로 스크롤을 덮어써 버리고 있었다.
    // scrollTrackingInputAboveKeyboard가 자기 자리를 맞춰놔도 그 직후(또는 그 전에) 이
    // 함수가 끼어들어 엉뚱한 곳으로 옮겨버리는 것 — 포커스된 트래킹 입력창이 있으면 아예
    // 건너뛴다
    if (focusedTrackingIdRef.current) return;
    const targetIndex = computeNowIndex(routines);
    if (targetIndex <= 0) return;
    const targetId = routines[targetIndex].id;
    const y = rowLayoutsRef.current[targetId];
    if (y === undefined) {
      if (attemptsLeft > 0) setTimeout(() => scrollListToNow(attemptsLeft - 1), 60);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listScrollRef.current?.scrollTo({ y: Math.max(0, y - 40), animated: false });
      });
    });
  }

  // 탭에 돌아올 때마다(repositionToken), routines 내용이 실제로 바뀔 때마다, 그리고
  // 타임라인→리스트 전환할 때 매번 다시 맞춘다. 단, 수정 화면에 갔다가 막 돌아온 경우엔
  // "지금 시각" 대신 방금 스와이프했던 그 루틴이 보이는 위치로 맞춘다
  useEffect(() => {
    if (viewMode !== 'list') return;
    const pendingId = pendingFocusRoutineIdRef.current;
    if (pendingId) {
      pendingFocusRoutineIdRef.current = null;
      scrollRowIntoView(pendingId);
    } else {
      scrollListToNow();
    }
  }, [routines, viewMode, repositionToken]);

  type TodayData = Awaited<ReturnType<typeof fetchTodayRoutines>>;
  const todayQueryKey = ['today-routines', userId, todayDateStr] as const;

  // 체크박스를 눌러도 서버 응답이 올 때까지(짧아도 수백ms~1초 이상) 화면이 그대로라
  // "렉 걸린다"는 피드백이 있었음 — onMutate에서 서버 응답을 기다리지 않고 화면부터 먼저
  // 바꾸고(낙관적 업데이트), 실패하면 onError에서 원래 상태로 되돌린다. 성공하면 onSuccess가
  // 임시로 넣어둔 값을 서버가 준 진짜 값으로 다시 한번 맞춰준다
  const toggleCheckMutation = useMutation({
    mutationFn: ({ routineId, existingId }: { routineId: string; existingId: string | null }) =>
      toggleCheckCompletion(routineId, existingId),
    onMutate: async ({ routineId, existingId }) => {
      await queryClient.cancelQueries({ queryKey: todayQueryKey });
      const previous = queryClient.getQueryData<TodayData>(todayQueryKey);
      queryClient.setQueryData(todayQueryKey, (old?: TodayData) => {
        if (!old) return old;
        if (existingId) {
          return { ...old, completions: old.completions.filter((c) => c.id !== existingId) };
        }
        const optimistic: RoutineCompletion = {
          id: `optimistic-${routineId}`,
          routine_id: routineId,
          completed_date: todayDateStr,
          tracking_value: null,
        };
        return { ...old, completions: [...old.completions, optimistic] };
      });
      return { previous };
    },
    onSuccess: (result, { routineId }) => {
      queryClient.setQueryData(todayQueryKey, (old?: TodayData) => {
        if (!old) return old;
        const nextCompletions = old.completions.filter((c) => c.routine_id !== routineId);
        if (result) nextCompletions.push(result);
        return { ...old, completions: nextCompletions };
      });
      if (userId) syncReminderAlarm(userId).catch(() => {});
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(todayQueryKey, context.previous);
      // 되돌린 상태가 서버의 실제 최신 상태와 다를 수 있으니(예: 다른 기기에서도 체크한 경우),
      // 새로고침 없이도 다음 조회에서 다시 맞춰지도록 무효화해둔다
      queryClient.invalidateQueries({ queryKey: todayQueryKey });
      setErrorMessage(t('today.errorCheck'));
    },
  });

  const skipTodayMutation = useMutation({
    mutationFn: (routineId: string) => skipRoutineToday(routineId),
    onMutate: async (routineId) => {
      await queryClient.cancelQueries({ queryKey: todayQueryKey });
      const previous = queryClient.getQueryData<TodayData>(todayQueryKey);
      queryClient.setQueryData(todayQueryKey, (old?: TodayData) => {
        if (!old) return old;
        return { ...old, routines: old.routines.filter((r) => r.id !== routineId) };
      });
      return { previous };
    },
    onSuccess: (_result, routineId) => {
      if (userId) syncReminderAlarm(userId).catch(() => {});
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(todayQueryKey, context.previous);
      setErrorMessage(t('today.errorDelete'));
    },
  });

  const saveTrackingMutation = useMutation({
    mutationFn: ({
      routineId,
      existingId,
      value,
    }: {
      routineId: string;
      existingId: string | null;
      value: number;
    }) => saveTrackingValue(routineId, existingId, value),
    onMutate: async ({ routineId, existingId, value }) => {
      await queryClient.cancelQueries({ queryKey: todayQueryKey });
      const previous = queryClient.getQueryData<TodayData>(todayQueryKey);
      queryClient.setQueryData(todayQueryKey, (old?: TodayData) => {
        if (!old) return old;
        const optimistic: RoutineCompletion = {
          id: existingId ?? `optimistic-${routineId}`,
          routine_id: routineId,
          completed_date: todayDateStr,
          tracking_value: value,
        };
        const nextCompletions = old.completions.filter((c) => c.routine_id !== routineId);
        nextCompletions.push(optimistic);
        return { ...old, completions: nextCompletions };
      });
      return { previous };
    },
    onSuccess: (result, { routineId }) => {
      queryClient.setQueryData(todayQueryKey, (old?: TodayData) => {
        if (!old) return old;
        const nextCompletions = old.completions.filter((c) => c.routine_id !== routineId);
        nextCompletions.push(result);
        return { ...old, completions: nextCompletions };
      });
      if (userId) syncReminderAlarm(userId).catch(() => {});
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(todayQueryKey, context.previous);
      setErrorMessage(t('today.errorSaveRecord'));
    },
  });

  // 체크/기록삭제/저장 핸들러들은 completions/trackingInputs를 state로 직접 참조하지 않고 ref로
  // 최신값만 읽는다 — useCallback([])로 항상 같은 함수 참조를 유지해야, 아래 ListRow에 준
  // React.memo가 "이 루틴은 안 바뀌었으니 다시 안 그려도 됨"이라고 판단할 수 있다(리스트/체크박스
  // 클릭 시 관계없는 다른 행까지 전부 다시 그려지며 렉이 걸리던 문제의 원인이었음)
  const completionsRef = useRef(completions);
  completionsRef.current = completions;
  const trackingInputsRef = useRef(trackingInputs);
  trackingInputsRef.current = trackingInputs;

  const closeEditTracking = useCallback((routineId: string) => {
    setEditingTrackingIds((prev) => {
      if (!prev.has(routineId)) return prev;
      const next = new Set(prev);
      next.delete(routineId);
      return next;
    });
  }, []);

  const startEditTracking = useCallback((routine: Routine) => {
    setEditingTrackingIds((prev) => new Set(prev).add(routine.id));
  }, []);

  // 수정 화면에서 돌아왔을 때/방금 체크한 트래킹 행을 다시 보여줄 때 등, 키보드와 무관하게
  // "이 루틴이 화면에 보이게 위쪽 근처로 당겨오는" 일반적인 용도 — rowLayoutsRef(콘텐츠 안에서
  // 대략 어디쯤인지)로 충분함
  const scrollRowIntoView = useCallback(function scrollRowIntoView(routineId: string, attemptsLeft = 6): void {
    const y = rowLayoutsRef.current[routineId];
    if (y === undefined) {
      if (attemptsLeft > 0) setTimeout(() => scrollRowIntoView(routineId, attemptsLeft - 1), 60);
      return;
    }
    listScrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }, []);

  // 트래킹 입력창이 화면 아래쪽에 있으면 키보드가 뜨는 순간 그 행이 가려져 숫자 입력하는
  // 모습을 못 보던 버그. 처음엔 "그 행이 콘텐츠 안에서 대략 어디쯤인지"(rowLayoutsRef, 위에서
  // 아래로 몇 px인지)로 추정해서 스크롤했는데, 그 행이 리스트 맨 아래쪽이라 애초에 그만큼
  // 스크롤할 여백 자체가 없거나(스크롤이 바닥에 막혀서 더 못 올라감), 추정이 살짝 어긋나면
  // 여전히 가려지는 경우가 있었음(2026-09-17) — 대신 입력창 자체를 measureInWindow로 재서
  // "지금 실제 화면 어디에 떠 있는지"를 직접 확인하고, 키보드가 가리는 만큼만 정확히
  // 계산해서 스크롤한다(추정이 아니라 실측이라 리스트 어느 위치에 있어도 확실히 동작함).
  // 아래 spacer(키보드 높이만큼 리스트 맨 아래에 까는 빈 공간)와 같이 써야, 맨 아래 행도
  // 실제로 그만큼 스크롤할 여백이 생겨서 이 계산대로 움직일 수 있다
  function scrollTrackingInputAboveKeyboard(routineId: string, keyboardHeightNow: number, attemptsLeft = 6): void {
    const node = trackingInputRefsRef.current[routineId];
    if (!node) return;
    node.measureInWindow((_x, y, _width, height) => {
      if (y === 0 && height === 0) {
        // 레이아웃이 아직 안 잡혔을 수 있어 잠깐 재시도한다(예: 막 펼쳐진 직후)
        if (attemptsLeft > 0) {
          setTimeout(() => scrollTrackingInputAboveKeyboard(routineId, keyboardHeightNow, attemptsLeft - 1), 60);
        }
        return;
      }
      const screenHeight = Dimensions.get('window').height;
      // KEYBOARD_GROWTH_SAFETY_MARGIN만큼 미리 여유를 더 두고 계산한다(위 상수 설명 참고) —
      // 이 여유 덕분에 나중에 자동완성 줄이 붙어 keyboardDidChangeFrame이 한 번 더 와도
      // overlap이 이미 0 이하라 다시 스크롤하지 않고 조용히 넘어간다
      const visibleBottom = screenHeight - keyboardHeightNow - KEYBOARD_GROWTH_SAFETY_MARGIN - 24; // 키보드 바로 위 여유
      const overlap = y + height - visibleBottom;
      if (overlap > 0) {
        listScrollRef.current?.scrollTo({ y: Math.max(0, listScrollYRef.current + overlap), animated: true });
      }
    });
  }

  // keyboardDidShow(키보드가 다 올라온 시점) 딱 한 번만 반응한다 — 예전엔 여기에
  // keyboardDidChangeFrame(안드로이드에서 오히려 keyboardDidShow와 겹쳐 두 번 불리는 경우가
  // 있었음)도 같이 듣고 있어서, 같은 키보드가 뜨는 동안 보정이 두 번 일어나며 "타이핑 중에
  // 한 번 더 움직이는" 것처럼 보였음(2026-09-17)
  //
  // ⚠️ 위 수정(keyboardDidChangeFrame 아예 안 듣기) 후에도, 그리고 keyboardDidShow만 디바운스한
  // 후에도 "숫자를 적으면 그제서야 한 번 더 튀는" 문제가 남아있었음 — 원인 재추적 결과,
  // 키보드가 이미 다 떠 있는 상태에서 첫 글자를 입력하면 안드로이드 자동완성/추천 줄이 그제서야
  // 붙으면서 키보드 실제 높이가 커지는데, 이건 "다시 뜨는" 게 아니라 "이미 떠 있는 키보드의
  // 프레임이 바뀌는" 것이라 keyboardDidShow가 아니라 keyboardDidChangeFrame으로 온다. 그런데
  // 이 이벤트를 아예 안 듣게 해놨으니 그 프레임 변화를 우리 스크롤 보정이 못 따라가서, 실제
  // 키보드가 커진 만큼 입력창이 도로 가려지고(OS가 화면을 강제로 눌러 올리며) "튀는" 것처럼
  // 보였던 것 — keyboardDidChangeFrame을 다시 듣되, keyboardDidShow와 같은 디바운스 타이머를
  // 공유해서 두 이벤트가 거의 동시에 올 땐 자연히 하나로 합쳐지고, 타이핑 중 나중에 따로 오는
  // 진짜 프레임 변화는 여전히 반영되게 한다
  useEffect(() => {
    const handleKeyboardHeight = (height: number) => {
      setKeyboardHeight(height);
      const id = focusedTrackingIdRef.current;
      if (!id || height <= 0) return;
      if (keyboardScrollSettleTimerRef.current) clearTimeout(keyboardScrollSettleTimerRef.current);
      keyboardScrollSettleTimerRef.current = setTimeout(() => {
        keyboardScrollSettleTimerRef.current = null;
        // 디바운스 대기 중 이미 다른 입력창으로 포커스가 옮겨갔으면 건너뛴다(엉뚱한 위치로 스크롤 방지)
        if (focusedTrackingIdRef.current === id) scrollTrackingInputAboveKeyboard(id, height);
      }, 150);
    };
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => handleKeyboardHeight(e.endCoordinates?.height ?? 0));
    const changeFrameSub = Keyboard.addListener('keyboardDidChangeFrame', (e) =>
      handleKeyboardHeight(e.endCoordinates?.height ?? 0)
    );
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      changeFrameSub.remove();
      hideSub.remove();
      if (keyboardScrollSettleTimerRef.current) clearTimeout(keyboardScrollSettleTimerRef.current);
    };
  }, []);

  const handleFocusTracking = useCallback((routineId: string) => {
    focusedTrackingIdRef.current = routineId;
  }, []);

  const handleBlurTracking = useCallback((routineId: string) => {
    if (focusedTrackingIdRef.current === routineId) focusedTrackingIdRef.current = null;
  }, []);

  const handleChangeTrackingInput = useCallback((routineId: string, text: string) => {
    setTrackingInputs((prev) => ({ ...prev, [routineId]: text }));
  }, []);

  // 체크박스를 빠르게 두 번 누르면, 첫 번째 요청의 서버 응답이 오기 전에 두 번째 요청이 "아직
  // 체크 안 된 상태"인 completionsRef를 보고 또 새로 체크 요청을 보내서 같은 날짜에 중복 기록이
  // 들어가려다 실패하고, 그 실패로 화면 상태가 꼬여 새로고침 전까지 계속 실패하는 문제가 있었음
  // — 처리 중인 루틴 id를 기록해두고, 응답이 오기 전 같은 루틴에 대한 요청은 그냥 무시한다
  const pendingToggleIdsRef = useRef<Set<string>>(new Set());

  const handleToggleCheck = useCallback((routine: Routine) => {
    if (pendingToggleIdsRef.current.has(routine.id)) return;
    pendingToggleIdsRef.current.add(routine.id);
    const existing = completionsRef.current[routine.id] ?? null;
    toggleCheckMutation.mutate(
      { routineId: routine.id, existingId: existing?.id ?? null },
      { onSettled: () => pendingToggleIdsRef.current.delete(routine.id) }
    );
  }, []);

  const handleSkipToday = useCallback((routine: Routine) => {
    skipTodayMutation.mutate(routine.id);
  }, []);

  const handleSaveTracking = useCallback(
    (routine: Routine) => {
      const raw = trackingInputsRef.current[routine.id];
      const value = Number(raw);
      if (!raw || Number.isNaN(value)) return;
      const existing = completionsRef.current[routine.id] ?? null;
      saveTrackingMutation.mutate({ routineId: routine.id, existingId: existing?.id ?? null, value });
      // 저장 즉시 "기록됨" 표시로 접어서, 입력창이 사라지고 새 값이 보이는 걸로 저장됐다는 걸 확인할 수 있게 한다
      closeEditTracking(routine.id);
    },
    [closeEditTracking]
  );

  // 트래킹 기록을 완전히 지운다(체크형의 "다시 눌러서 해제"에 해당) — 저장된 값 자체를 없애고
  // 싶을 때 쓰는 용도라, 값을 지우는 completion 삭제(toggleCheckCompletion의 delete 경로)를
  // 그대로 재사용한다(어떤 block_type이든 id로만 지우므로 문제없음)
  const handleCancelTracking = useCallback(
    (routine: Routine) => {
      if (pendingToggleIdsRef.current.has(routine.id)) return;
      const existing = completionsRef.current[routine.id];
      if (!existing) return;
      pendingToggleIdsRef.current.add(routine.id);
      toggleCheckMutation.mutate(
        { routineId: routine.id, existingId: existing.id },
        { onSettled: () => pendingToggleIdsRef.current.delete(routine.id) }
      );
      closeEditTracking(routine.id);
      swipeRefsRef.current[routine.id]?.close();
      scrollRowIntoView(routine.id);
    },
    [closeEditTracking, scrollRowIntoView]
  );

  const handleEditRoutine = useCallback(
    (routine: Routine) => {
      swipeRefsRef.current[routine.id]?.close();
      pendingFocusRoutineIdRef.current = routine.id;
      router.push({ pathname: '/routine-form', params: { id: routine.id } });
    },
    [router]
  );

  const handlePlayVideo = useCallback(
    (videoId: string) => {
      router.push({ pathname: '/video-player', params: { id: videoId } });
    },
    [router]
  );

  // flat=true면 "지금" 그룹 박스 안에 여러 개가 같이 들어있는 경우 — 그룹 박스 자체가 이미
  // 강조 테두리를 그려주므로 각 행은 자기만의 테두리 없이 밋밋하게(flat) 그린다
  if (todayQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    // 트래킹 입력창(이 화면의 유일한 입력창)은 이미 위에서 직접 측정해서 스크롤로 키보드
    // 위로 올리는 걸 전부 처리하고 있어서, KeyboardAvoidingView까지 같이 쓰면 키보드 프레임이
    // 또 바뀔 때(예: 자동완성 줄) 둘이 동시에 반응해서 "우리가 이미 맞춰둔 위치가 한 번 더
    // 움직이는" 이중 보정처럼 보였음(2026-09-17) — 이 화면은 KeyboardAvoidingView 없이 우리
    // 로직만으로 처리한다
    <View style={styles.container}>
      <View style={styles.header}>
        <AnimatedPressable style={styles.addButton} onPress={() => router.push('/routine-form')}>
          <Text style={styles.addButtonText}>{t('today.addRoutine')}</Text>
        </AnimatedPressable>
      </View>

      {/* 예전엔 가로 스크롤 칩이었는데, 언어에 따라 글자 길이가 달라지면(한글은 짧아서 꽉
          차 보이고, 영어는 짧게 줄여도 남는 공간이 생겨 어중간해 보였음) 매번 다르게 보이는
          문제가 있어서, 4등분 flex로 바꿔 화면 폭을 항상 꽉 채우도록 통일했다 */}
      <View style={styles.headerButtonsRow}>
        <AnimatedPressable style={styles.presetButton} onPress={() => router.push('/videos')}>
          <Ionicons name="film-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText} numberOfLines={1}>
            {t('today.video')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={styles.presetButton}
          onPress={() => router.push({ pathname: '/diary-form', params: { date: formatLocalDate(new Date()) } })}>
          <Ionicons name="book-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText} numberOfLines={1}>
            {t('today.diary')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable style={styles.presetButton} onPress={() => router.push('/presets')}>
          <Ionicons name="albums-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText} numberOfLines={1}>
            {t('today.presets')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable style={styles.presetButton} onPress={() => router.push('/my-routines')}>
          <Ionicons name="list-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText} numberOfLines={1}>
            {t('today.myRoutines')}
          </Text>
        </AnimatedPressable>
      </View>

      <View style={styles.viewModeTabs}>
        <AnimatedPressable
          style={[styles.viewModeTab, viewMode === 'list' && styles.viewModeTabActive]}
          onPress={() => setViewMode('list')}>
          <Text style={[styles.viewModeTabText, viewMode === 'list' && styles.viewModeTabTextActive]}>
            {t('today.list')}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.viewModeTab, viewMode === 'timeline' && styles.viewModeTabActive]}
          onPress={() => setViewMode('timeline')}>
          <Text style={[styles.viewModeTabText, viewMode === 'timeline' && styles.viewModeTabTextActive]}>
            {t('today.timeline')}
          </Text>
        </AnimatedPressable>
      </View>

      {/* 그림자+테두리(ShadowCard)까지 통째로 눌림 애니메이션 대상에 포함시켜야 함 — 안쪽 배너만
          줄어들면 그 밖의 정적인 테두리/그림자가 그대로 남아 테두리 선처럼 비쳐 보임 */}
      <AnimatedPressable onPress={() => router.push('/llm-input')}>
        <ShadowCard style={styles.llmBannerOuter} contentStyle={styles.llmBannerContent}>
          <View style={styles.llmBanner}>
            <View style={styles.llmBannerLeft}>
              <Ionicons name="sparkles-outline" size={16} color="#fff" />
              <Text style={styles.llmBannerText} numberOfLines={1}>
                {t('today.llmBanner')}
              </Text>
            </View>
            {llmQuota && (
              <Text style={styles.llmBannerCount} numberOfLines={1}>
                {t('llmInput.remainingQuotaPrefix')}
                {llmQuota.remaining}/{llmQuota.limit}
                {t('llmInput.remainingQuotaSuffix')}
              </Text>
            )}
          </View>
        </ShadowCard>
      </AnimatedPressable>

      {holiday && (
        <View style={styles.holidayBanner}>
          <Ionicons name="flag-outline" size={14} color="#fff" />
          <Text style={styles.holidayBannerText}>
            {t('today.holidayPrefix')} {holiday.name}
          </Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      {viewMode === 'timeline' ? (
        <TimelineView
          routines={routines}
          completions={completions}
          onToggleCheck={handleToggleCheck}
          onEdit={(routine) => router.push({ pathname: '/routine-form', params: { id: routine.id } })}
          repositionToken={repositionToken}
        />
      ) : (
      <ScrollView
        ref={listScrollRef}
        style={styles.list}
        contentContainerStyle={routines.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          listScrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        onContentSizeChange={scrollListToNow}>
        {routines.length === 0 ? (
          <Text style={styles.emptyText}>{t('today.empty')}</Text>
        ) : (
          (() => {
            // "지금" 강조가 필요한 루틴이 여러 개 연달아 있으면(같은 시간대에 몰린 경우) 각자
            // 따로 테두리를 그려서 너무 번잡해 보인다는 피드백 — 연속된 "지금" 루틴들은 하나의
            // 큰 포인트 컬러 박스로 묶어서 보여준다
            type RowGroup = { items: Routine[]; isNow: boolean };
            const rowGroups: RowGroup[] = [];
            for (const item of routines) {
              const itemRange = effectiveTimeRange(item);
              const isNow = itemRange ? isNowWithinRange(itemRange, item.is_instant) : false;
              const last = rowGroups[rowGroups.length - 1];
              if (isNow && last?.isNow) {
                last.items.push(item);
              } else {
                rowGroups.push({ items: [item], isNow });
              }
            }

            return rowGroups.map((group, groupIndex) => {
              const isGroupBox = group.items.length > 1;
              return (
                <View
                  key={isGroupBox ? `now-group-${groupIndex}` : group.items[0].id}
                  style={isGroupBox ? styles.nowGroupBox : undefined}
                  onLayout={(e) => {
                    // 그룹 전체의 시작 y좌표를 그룹에 속한 모든 루틴 id에 똑같이 기록해둔다 —
                    // "지금" 루틴으로 스크롤할 땐 그 그룹의 맨 위가 보이면 되므로 충분히 정확함
                    const y = e.nativeEvent.layout.y;
                    for (const it of group.items) rowLayoutsRef.current[it.id] = y;
                  }}>
                  {group.items.map((item) => (
                    <ListRow
                      key={item.id}
                      item={item}
                      isNow={group.isNow}
                      flat={isGroupBox}
                      completion={completions[item.id]}
                      isEditingTracking={editingTrackingIds.has(item.id)}
                      trackingInputValue={trackingInputs[item.id] ?? ''}
                      styles={styles}
                      swipeRefsRef={swipeRefsRef}
                      swipeAutoCloseTimersRef={swipeAutoCloseTimersRef}
                      trackingInputRefsRef={trackingInputRefsRef}
                      onEdit={handleEditRoutine}
                      onToggleCheck={handleToggleCheck}
                      onSkipToday={handleSkipToday}
                      onCancelTracking={handleCancelTracking}
                      onStartEditTracking={startEditTracking}
                      onCloseEditTracking={closeEditTracking}
                      onSaveTracking={handleSaveTracking}
                      onChangeTrackingInput={handleChangeTrackingInput}
                      onFocusTracking={handleFocusTracking}
                      onBlurTracking={handleBlurTracking}
                      onPlayVideo={handlePlayVideo}
                    />
                  ))}
                </View>
              );
            });
          })()
        )}
        {/* KEYBOARD_GROWTH_SAFETY_MARGIN만큼 미리 여유를 더 얹은 목표 위치까지 스크롤할 수 있어야
            하므로, 그만큼 더 큰 여백을 깔아둔다(안 그러면 맨 아래 행일 때 스크롤이 바닥에 막혀
            의도한 여유만큼 못 올라간다) */}
        {keyboardHeight > 0 && <View style={{ height: keyboardHeight + KEYBOARD_GROWTH_SAFETY_MARGIN }} />}
      </ScrollView>
      )}

      {routines.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {t('today.completedLabel')} {routines.filter((r) => completions[r.id]).length}/{routines.length} (
            {Math.round((routines.filter((r) => completions[r.id]).length / routines.length) * 100)}%)
          </Text>
        </View>
      )}

    </View>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  // 리스트 제목 글자는 기본 폰트든 동글 폰트든 유독 커 보인다는 피드백으로 -2 → -4까지 줄였다가,
  // 너무 작아졌다는 재피드백으로 1px 다시 키워서 -3
  const listTitleExtraAdjust = -3;
  return StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  llmBannerOuter: {
    marginHorizontal: 20,
    marginBottom: 12,
    // 이 배너만 배경을 진하게 채운 포인트색 카드라 공용 그림자(cardShadow)를 그대로 쓰면
    // 특히 연한 테마색(노랑 등)에서 유독 그림자만 진해 보임 — 이 카드만 옅게 낮춘다
    shadowOpacity: 0,
    elevation: 0,
  },
  // 배경이 흰 카드가 아니라 포인트색으로 꽉 채워진 배너라, 테두리는 회색 대신 진한 톤으로 덮어씀
  llmBannerContent: {
    borderColor: 'rgba(0,0,0,0.15)',
  },
  llmBanner: {
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  llmBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    backgroundColor: 'transparent',
  },
  llmBannerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  llmBannerCount: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    flexShrink: 0,
  },
  headerButtonsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  presetButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  // 언어를 바꾸면 글자 길이가 달라져서(영어 "Routines"가 한글 "내 루틴"보다 김) 4등분 폭에서
  // 살짝 빠듯할 수 있어 폰트를 조금 작게 잡는다
  presetButtonText: {
    color: textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  viewModeTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.08)',
    padding: 4,
    gap: 4,
  },
  viewModeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: cardRadius,
    alignItems: 'center',
  },
  viewModeTabActive: {
    backgroundColor: accent,
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
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: cardRadius,
    backgroundColor: 'rgba(255, 107, 107, 0.55)',
  },
  errorBannerText: {
    color: '#fff',
    fontSize: 16 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  holidayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: cardRadius,
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
    borderRadius: cardRadius,
  },
  rowHighlighted: {
    borderColor: accent,
  },
  nowGroupBox: {
    borderWidth: 1.5,
    borderColor: accent,
    backgroundColor: 'rgba(169, 196, 224, 0.06)',
    borderRadius: cardRadius,
    overflow: 'hidden',
  },
  rowFlat: {
    borderWidth: 0,
    borderRadius: 0,
  },
  timeColumn: {
    width: 70,
  },
  time: {
    fontSize: 10,
    opacity: 0.6,
    fontFamily: fontMono,
  },
  timeSub: {
    fontSize: 10,
    opacity: 0.45,
    marginTop: 1,
    fontFamily: fontMono,
  },
  rowMain: {
    flex: 1,
    position: 'relative',
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: 18 + fontKorean.sizeAdjust + listTitleExtraAdjust,
    lineHeight: 24 + fontKorean.sizeAdjust + listTitleExtraAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  rowTitleDone: {
    opacity: 0.4,
  },
  requiredBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -4,
    height: 2,
    backgroundColor: withAlpha(accent, 0.35),
  },
  // 체크박스(28px)와 시각적 중심을 맞추기 위해 같은 높이로 고정하고 그 안에서 가운데 정렬
  trackingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 6,
    flexShrink: 0,
  },
  trackingInput: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 44,
    fontFamily: fontKorean.fontFamily,
  },
  trackingDoneBadge: {
    fontSize: 12,
    color: accent,
    fontWeight: '600',
    includeFontPadding: false,
  },
  cancelTrackingButton: {
    height: 28,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelTrackingButtonText: {
    fontSize: 12,
    color: dangerMuted,
    includeFontPadding: false,
  },
  unit: {
    fontSize: 13,
    opacity: 0.7,
    includeFontPadding: false,
  },
  saveButton: {
    height: 28,
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    includeFontPadding: false,
  },
  // 체크박스/저장 버튼/완료 뱃지가 항상 같은 가로 위치에서 중심을 잡도록 고정폭 슬롯으로 감쌈
  // (버튼 내용이 이 폭보다 작아야 눌려서 깨지지 않음 — "저장" 버튼 기준 여유있게 56)
  actionSlot: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: accent,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  swipeActionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  // 스와이프하면 "수정"이 먼저(앞쪽) 보이는데, 꽉 채운 진한 색이 제일 먼저 무겁게 보인다는
  // 피드백으로 "오늘삭제"와 스타일을 맞바꿨다(2026-09-17) — 앞쪽인 수정은 옅게, 뒤쪽인
  // 삭제는 진하게
  editAction: {
    backgroundColor: withAlpha(accent, 0.15),
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: cardRadius,
    marginVertical: 2,
  },
  editActionText: {
    color: accent,
    fontSize: 12,
    fontWeight: '600',
  },
  cancelTrackingAction: {
    backgroundColor: dangerMuted,
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: cardRadius,
    marginVertical: 2,
  },
  playButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  playButtonText: {
    fontSize: 14,
    color: accent,
  },
  deleteAction: {
    backgroundColor: accent,
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: cardRadius,
    marginVertical: 2,
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: 13 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
    opacity: 0.7,
  },
  });
}
