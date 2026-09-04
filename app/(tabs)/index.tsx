import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  type DimensionValue,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, dangerMuted, fontMono, textMuted, withAlpha } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
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
  emojiForStreak,
  fetchStats,
  fetchStreakConfigs,
  fetchStreaks,
  fetchTodayRoutines,
  formatLocalDate,
  saveTrackingValue,
  skipRoutineToday,
  slotTimeLabel,
  toggleCheckCompletion,
  SLOT_LABELS,
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

function timeLabel(routine: Routine): string {
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
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '';
}

const HOUR_HEIGHT = 56;
const ROW_HEIGHT = 34;

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
        <Text style={timelineStyles.emptyText}>시간 정보가 있는 루틴이 없어요</Text>
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
              <Pressable style={timelineStyles.blockContent} onPress={() => onEdit(routine)}>
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
              </Pressable>
              {routine.block_type === 'check' ? (
                <Pressable
                  hitSlop={8}
                  style={[timelineStyles.blockCheckbox, isDone && timelineStyles.blockCheckboxDone]}
                  onPress={() => onToggleCheck(routine)}>
                  {isDone && <Text style={timelineStyles.blockCheckmark}>✓</Text>}
                </Pressable>
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
            <Pressable
              style={timelineStyles.hintCheckboxRow}
              onPress={() => setDontShowSlotHintAgain((v) => !v)}
              hitSlop={6}>
              <View style={[timelineStyles.hintCheckbox, dontShowSlotHintAgain && timelineStyles.hintCheckboxChecked]}>
                {dontShowSlotHintAgain && <Text style={timelineStyles.hintCheckmark}>✓</Text>}
              </View>
              <Text style={timelineStyles.hintCheckboxLabel}>다시 안 보기</Text>
            </Pressable>
            <Pressable onPress={closeSlotHint} hitSlop={6}>
              <Text style={timelineStyles.hintCloseText}>닫기</Text>
            </Pressable>
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
                <Pressable
                  style={[
                    timelineStyles.block,
                    timelineStyles.moreBlock,
                    { top: clusterTop, height: first.height, left: '84%', width: '16%' },
                  ]}
                  onPress={() => setExpandedClusters((prev) => new Set(prev).add(clusterId))}>
                  <Text style={timelineStyles.moreBlockText}>+{hiddenCount}</Text>
                </Pressable>
              </Fragment>
            );
          }

          return (
            <Fragment key={clusterId}>
              {sortedItems.map((block, index) => {
                const offsetTop =
                  clusterTop + sortedItems.slice(0, index).reduce((sum, b) => sum + b.height, 0);
                return renderBlock(block, {
                  top: offsetTop,
                  height: block.height,
                  left: '0%',
                  width: '100%',
                  showTime: true,
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
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 87, 34, 0.4)',
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
  blockTitleNow: {
    textDecorationLine: 'underline',
    fontWeight: '700',
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
    fontSize: 16 + fontKorean.sizeAdjust,
    lineHeight: 21 + fontKorean.sizeAdjust,
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

export default function TodayScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
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
  useRefetchOnFocus(todayQuery.refetch);

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
      setErrorMessage('루틴을 불러오지 못했어요. 다시 시도해주세요.');
    }
  }, [todayQuery.isFetching, todayQuery.isError]);

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

  // 스트릭은 배지 장식용이라 필수 정보가 아님 — 오늘 목록 쿼리가 끝난 뒤에만 이어서 돈다
  // (enabled). 목록이 뜨는 걸 기다리게 하지 않아서 첫 로딩 체감 속도가 그대로 유지된다.
  const streaksQuery = useQuery({
    queryKey: ['streaks', userId, routines.map((r) => r.id), todayDateStr],
    queryFn: () => fetchStreaks(routines, todayDateStr),
    enabled: !!todayQuery.data,
  });
  const streaks = streaksQuery.data ?? {};

  // 스트릭 등급(이모지) 설정은 자주 안 바뀌는 참조 데이터라 1시간 정도는 캐시된 값을 그대로 씀
  const streakConfigsQuery = useQuery({
    queryKey: ['streak-configs'],
    queryFn: fetchStreakConfigs,
    staleTime: 60 * 60 * 1000,
  });
  const streakConfigs = streakConfigsQuery.data ?? [];

  // LLM 남은 횟수: 화면에 들어올 때마다 갱신(배너 표시용)
  const llmQuotaQuery = useQuery({
    queryKey: ['llm-quota', userId],
    queryFn: fetchLlmQuota,
    enabled: !!userId,
  });
  useRefetchOnFocus(llmQuotaQuery.refetch);
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
      queryClient.invalidateQueries({ queryKey: ['streaks', userId] });
      if (userId) syncReminderAlarm(userId).catch(() => {});
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(todayQueryKey, context.previous);
      setErrorMessage('체크 처리에 실패했어요.');
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
      setErrorMessage('삭제에 실패했어요.');
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
      queryClient.invalidateQueries({ queryKey: ['streaks', userId] });
      if (userId) syncReminderAlarm(userId).catch(() => {});
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(todayQueryKey, context.previous);
      setErrorMessage('기록 저장에 실패했어요.');
    },
  });

  function handleToggleCheck(routine: Routine) {
    const existing = completions[routine.id] ?? null;
    toggleCheckMutation.mutate({ routineId: routine.id, existingId: existing?.id ?? null });
  }

  function handleSkipToday(routine: Routine) {
    skipTodayMutation.mutate(routine.id);
  }

  function closeEditTracking(routineId: string) {
    setEditingTrackingIds((prev) => {
      if (!prev.has(routineId)) return prev;
      const next = new Set(prev);
      next.delete(routineId);
      return next;
    });
  }

  function startEditTracking(routine: Routine) {
    setEditingTrackingIds((prev) => new Set(prev).add(routine.id));
  }

  // 트래킹 입력창이 화면 아래쪽에 있으면 키보드가 뜨는 순간 화면(또는 그 행)이 키보드에 가려져
  // 저장 버튼을 못 누르던 버그 — 입력창에 포커스가 잡히면 그 행을 스크롤 뷰 위쪽 가까이로
  // 당겨온다. 키보드는 화면 "아래"만 가리므로, 위쪽 근처로 당겨두면 키보드 높이와 무관하게
  // 행과 저장 버튼이 항상 보이는 영역에 남는다.
  // 포커스되는 순간 바로 한 번 시도하는 것만으로는 부족했음 — ScrollView가 원래 갖고 있는
  // "포커스된 입력칸을 키보드 위로 자동 스크롤"하는 기본 동작이 키보드가 다 올라온 뒤에
  // 한 번 더 끼어들어서, 우리가 옮겨둔 위치를 다시 아래로 밀어버리는 문제가 있었음 — 그래서
  // keyboardDidShow(키보드가 완전히 다 올라온 시점) 때 한 번 더 강제로 맞춰서 마지막에
  // 우리가 원하는 위치로 확정시킨다
  function scrollRowIntoView(routineId: string, attemptsLeft = 6) {
    const y = rowLayoutsRef.current[routineId];
    if (y === undefined) {
      // 화면 복귀 직후처럼 아직 그 행의 레이아웃이 안 잡혔을 수 있어 잠깐 재시도한다
      if (attemptsLeft > 0) setTimeout(() => scrollRowIntoView(routineId, attemptsLeft - 1), 60);
      return;
    }
    listScrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      const id = focusedTrackingIdRef.current;
      if (id) scrollRowIntoView(id);
    });
    return () => sub.remove();
  }, []);

  function handleSaveTracking(routine: Routine) {
    const raw = trackingInputs[routine.id];
    const value = Number(raw);
    if (!raw || Number.isNaN(value)) return;
    const existing = completions[routine.id] ?? null;
    saveTrackingMutation.mutate({ routineId: routine.id, existingId: existing?.id ?? null, value });
    // 저장 즉시 "기록됨" 표시로 접어서, 입력창이 사라지고 새 값이 보이는 걸로 저장됐다는 걸 확인할 수 있게 한다
    closeEditTracking(routine.id);
  }

  // 트래킹 기록을 완전히 지운다(체크형의 "다시 눌러서 해제"에 해당) — 저장된 값 자체를 없애고
  // 싶을 때 쓰는 용도라, 값을 지우는 completion 삭제(toggleCheckCompletion의 delete 경로)를
  // 그대로 재사용한다(어떤 block_type이든 id로만 지우므로 문제없음)
  function handleCancelTracking(routine: Routine) {
    const existing = completions[routine.id];
    if (!existing) return;
    toggleCheckMutation.mutate({ routineId: routine.id, existingId: existing.id });
    closeEditTracking(routine.id);
    swipeRefsRef.current[routine.id]?.close();
    scrollRowIntoView(routine.id);
  }

  // flat=true면 "지금" 그룹 박스 안에 여러 개가 같이 들어있는 경우 — 그룹 박스 자체가 이미
  // 강조 테두리를 그려주므로 각 행은 자기만의 테두리 없이 밋밋하게(flat) 그린다
  function renderListRow(item: Routine, isNow: boolean, flat: boolean) {
    const completion = completions[item.id];
    const isDone = Boolean(completion);
    const streakDays = streaks[item.id] ?? 0;
    const streakEmoji = emojiForStreak(streakDays, streakConfigs);

    function goToEdit() {
      swipeRefsRef.current[item.id]?.close();
      pendingFocusRoutineIdRef.current = item.id;
      router.push({ pathname: '/routine-form', params: { id: item.id } });
    }

    return (
      <Swipeable
        key={item.id}
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
            <Pressable style={styles.editAction} onPress={goToEdit}>
              <Text style={styles.editActionText}>수정</Text>
            </Pressable>
            {item.block_type === 'tracking' && isDone && !editingTrackingIds.has(item.id) && (
              <Pressable style={styles.cancelTrackingAction} onPress={() => handleCancelTracking(item)}>
                <Text style={styles.editActionText}>기록삭제</Text>
              </Pressable>
            )}
            <Pressable style={styles.deleteAction} onPress={() => handleSkipToday(item)}>
              <Text style={styles.deleteActionText}>오늘 삭제</Text>
            </Pressable>
          </View>
        )}>
        <View style={[styles.row, isNow && !flat && styles.rowHighlighted, flat && styles.rowFlat]}>
          <View style={styles.timeColumn}>
            <Text style={styles.time} numberOfLines={1}>
              {timeLabel(item)}
            </Text>
            {item.slots && (
              <Text style={styles.timeSub} numberOfLines={1}>
                {slotTimeLabel(item.slots)}
              </Text>
            )}
          </View>
          <View style={styles.rowMain}>
            <Pressable style={styles.titleLine} onPress={goToEdit}>
              <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]} numberOfLines={1}>
                {item.title}
              </Text>
              {streakEmoji && (
                <Text style={styles.streakBadge}>
                  {streakEmoji} {streakDays}일
                </Text>
              )}
            </Pressable>
            {item.is_required && !isDone && <View style={styles.requiredBar} />}
          </View>

          {item.video_id && (
            <Pressable
              style={styles.playButton}
              onPress={() => router.push({ pathname: '/video-player', params: { id: item.video_id! } })}>
              <Text style={styles.playButtonText}>▶</Text>
            </Pressable>
          )}

          {item.block_type === 'check' && (
            <View style={styles.actionSlot}>
              <Pressable
                style={[styles.checkbox, isDone && styles.checkboxDone]}
                onPress={() => handleToggleCheck(item)}>
                {isDone && <Text style={styles.checkmark}>✓</Text>}
              </Pressable>
            </View>
          )}

          {item.block_type === 'tracking' ? (
            isDone && !editingTrackingIds.has(item.id) ? (
              <View style={styles.actionSlot}>
                <Pressable onPress={() => startEditTracking(item)}>
                  <Text style={styles.trackingDoneBadge} numberOfLines={1}>
                    ✓ {completion?.tracking_value} {item.tracking_unit}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.trackingRow}>
                  <TextInput
                    style={styles.trackingInput}
                    keyboardType="numeric"
                    value={trackingInputs[item.id] ?? ''}
                    onChangeText={(text) => setTrackingInputs((prev) => ({ ...prev, [item.id]: text }))}
                    onFocus={() => {
                      focusedTrackingIdRef.current = item.id;
                      scrollRowIntoView(item.id);
                    }}
                    onBlur={() => {
                      if (focusedTrackingIdRef.current === item.id) focusedTrackingIdRef.current = null;
                    }}
                    placeholder="0"
                    autoFocus={isDone}
                  />
                  <Text style={styles.unit}>{item.tracking_unit}</Text>
                  {isDone && (
                    <Pressable style={styles.cancelTrackingButton} onPress={() => closeEditTracking(item.id)}>
                      <Text style={styles.cancelTrackingButtonText}>닫기</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.actionSlot}>
                  <Pressable style={styles.saveButton} onPress={() => handleSaveTracking(item)}>
                    <Text style={styles.saveButtonText}>저장</Text>
                  </Pressable>
                </View>
              </>
            )
          ) : null}
        </View>
      </Swipeable>
    );
  }

  if (todayQuery.isLoading) {
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
        <Pressable style={styles.addButton} onPress={() => router.push('/routine-form')}>
          <Text style={styles.addButtonText}>+ 루틴 추가</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        persistentScrollbar
        style={styles.headerButtonsScroll}
        contentContainerStyle={styles.headerButtonsContent}>
        <Pressable style={styles.presetButton} onPress={() => router.push('/videos')}>
          <Ionicons name="film-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText}>영상</Text>
        </Pressable>
        <Pressable
          style={styles.presetButton}
          onPress={() => router.push({ pathname: '/diary-form', params: { date: formatLocalDate(new Date()) } })}>
          <Ionicons name="book-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText}>일기</Text>
        </Pressable>
        <Pressable style={styles.presetButton} onPress={() => router.push('/presets')}>
          <Ionicons name="albums-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText}>모음집</Text>
        </Pressable>
        <Pressable style={styles.presetButton} onPress={() => router.push('/my-routines')}>
          <Ionicons name="list-outline" size={14} color={accent} />
          <Text style={styles.presetButtonText}>내 루틴</Text>
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

      <ShadowCard style={styles.llmBannerOuter} contentStyle={styles.llmBannerContent}>
        <Pressable style={styles.llmBanner} onPress={() => router.push('/llm-input')}>
          <View style={styles.llmBannerLeft}>
            <Ionicons name="sparkles-outline" size={16} color="#fff" />
            <Text style={styles.llmBannerText}>말로 루틴 추가하기</Text>
          </View>
          {llmQuota && (
            <Text style={styles.llmBannerCount}>
              남은 {llmQuota.remaining}/{llmQuota.limit}회
            </Text>
          )}
        </Pressable>
      </ShadowCard>

      {holiday && (
        <View style={styles.holidayBanner}>
          <Ionicons name="flag-outline" size={14} color="#fff" />
          <Text style={styles.holidayBannerText}>오늘은 {holiday.name}이에요</Text>
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
        onContentSizeChange={scrollListToNow}>
        {routines.length === 0 ? (
          <Text style={styles.emptyText}>오늘 할 루틴이 없어요</Text>
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
                  {group.items.map((item) => renderListRow(item, group.isNow, isGroupBox))}
                </View>
              );
            });
          })()
        )}
      </ScrollView>
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

    </KeyboardAvoidingView>
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
  },
  llmBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
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
  headerButtonsScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  headerButtonsContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetButtonText: {
    color: textMuted,
    fontSize: 13,
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
    fontSize: 18 + fontKorean.sizeAdjust,
    lineHeight: 24 + fontKorean.sizeAdjust,
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
  streakBadge: {
    fontSize: 12,
    opacity: 0.7,
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
  editAction: {
    backgroundColor: accent,
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: cardRadius,
    marginVertical: 2,
  },
  editActionText: {
    color: '#fff',
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
    backgroundColor: '#FF6B6B',
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
