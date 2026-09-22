import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  type DimensionValue,
} from 'react-native';
import { Gesture, GestureDetector, Swipeable } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, dangerMuted, fontMono, withAlpha } from '@/constants/theme';
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

const SHORT_WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function repeatLabel(routine: Routine, t: (key: TranslationKey) => string): string {
  switch (routine.repeat_type) {
    case 'daily':
      return t('myRoutines.repeatDaily');
    case 'weekday':
      return t('myRoutines.repeatWeekday');
    case 'weekend':
      return t('myRoutines.repeatWeekend');
    case 'custom': {
      // "커스텀"이라고만 하면 정보가 없어 보여서, 실제 고른 요일을 그대로 보여준다
      const days = (routine.repeat_days ?? []).slice().sort();
      if (days.length === 0) return t('myRoutines.repeatCustom');
      return days.map((d) => SHORT_WEEKDAY_LABELS[d]).join(',');
    }
    case 'once':
      return t('myRoutines.repeatOnce');
    default:
      return '';
  }
}

const HOUR_HEIGHT = 56;
const ROW_HEIGHT = 34;
const EXPANDED_ROW_GAP = 4;
// 시각 체크(is_instant, 그 순간에만 체크하는 타입)는 실제로 시간을 차지하지 않고 34px짜리
// 작은 블록 하나만 그리는데, 그 블록이 있는 시간대를 다른 시각형 루틴과 똑같이 HOUR_HEIGHT
// (56px)만큼 잡아두면 블록 아래로 남는 흰 여백이 눈에 띄게 두드러진다 — 시각 체크만 있는
// 시간대는 이 작은 블록 하나 들어갈 정도로만 짧게 잡는다.
// ⚠️ 34px 블록 높이에 딱 맞는 36px로 처음 잡았더니, 시각 체크가 연달아(다른 시간대에)
// 있으면 위아래 여백이 겨우 1px씩이라 블록끼리 거의 붙어 보였다 — 44px(위아래 각각 5px)로
// 한 번 늘렸는데도 여전히 붙어 보인다는 신고가 있어(2026-09-21) 한 번 더 늘림(위아래 각각 10px)
const INSTANT_HOUR_HEIGHT = 54;
// 아침/저녁처럼 루틴이 드문드문 있으면 그 사이 빈 시간대까지 전부 HOUR_HEIGHT만큼 그려서
// 스크롤을 한참 해야 했음 — 루틴이 하나도 없는 시간대가 이만큼(시간) 연달아 이어지면
// 한 덩어리로 압축해서 짧게 보여준다(COLLAPSED_GAP_HEIGHT)
const MIN_EMPTY_HOURS_TO_COLLAPSE = 2;
const COLLAPSED_GAP_HEIGHT = 28;

// 시간대별로 실제 무엇이 있는지 분류 — 'full'은 실제 소요시간이 있는 루틴이 걸쳐있는 시간
// (기존처럼 꽉 찬 HOUR_HEIGHT 필요), 'instant'는 시각 체크만 있는 시간(짧게만 잡아도 됨),
// 없으면 압축(collapse) 대상
type HourKind = 'full' | 'instant';

// 시간축 좌표 계산을 "빈 시간대 압축 + 시각체크 시간대 축소"까지 감안해서 한 곳에 모아둔 것.
// 압축 안 하는 짧은 공백(1시간 이하)은 기존처럼 HOUR_HEIGHT로 그대로 둬서 평소 느낌을 유지한다
type HourSegment = { hour: number; hourSpan: number; pixelHeight: number };

function buildHourSegments(minHour: number, maxHour: number, hourKinds: Map<number, HourKind>): HourSegment[] {
  const segments: HourSegment[] = [];
  let h = minHour;
  while (h < maxHour) {
    const kind = hourKinds.get(h);
    if (kind) {
      segments.push({ hour: h, hourSpan: 1, pixelHeight: kind === 'instant' ? INSTANT_HOUR_HEIGHT : HOUR_HEIGHT });
      h += 1;
      continue;
    }
    let runEnd = h;
    while (runEnd < maxHour && !hourKinds.has(runEnd)) runEnd += 1;
    const runLength = runEnd - h;
    if (runLength >= MIN_EMPTY_HOURS_TO_COLLAPSE) {
      segments.push({ hour: h, hourSpan: runLength, pixelHeight: COLLAPSED_GAP_HEIGHT });
    } else {
      for (let i = h; i < runEnd; i++) segments.push({ hour: i, hourSpan: 1, pixelHeight: HOUR_HEIGHT });
    }
    h = runEnd;
  }
  return segments;
}

// 하루 중 "분" 단위 시각(0~1440)을 위 세그먼트를 반영한 실제 화면 y좌표(px)로 변환
function makeMinutesToY(segments: HourSegment[], minHour: number) {
  return function minutesToY(minutes: number): number {
    let y = 0;
    for (const seg of segments) {
      const segStartMin = seg.hour * 60;
      const segEndMin = segStartMin + seg.hourSpan * 60;
      if (minutes < segEndMin) {
        const fraction = Math.max(0, minutes - segStartMin) / (seg.hourSpan * 60);
        return y + fraction * seg.pixelHeight;
      }
      y += seg.pixelHeight;
    }
    // minHour보다 이른 시각(사실상 없음) 대비 폴백
    return minutes < minHour * 60 ? 0 : y;
  };
}

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

// "리스트/타임라인" 중 두 번 탭해서 고른 기본 화면 — 앱을 껐다 켜도 이 값으로 시작한다
const DEFAULT_VIEW_MODE_KEY = 'today_default_view_mode';
// "다시 보지 않음"을 체크하고 닫아야만 'true'로 저장된다
const VIEW_MODE_HINT_DISMISSED_KEY = 'today_view_mode_hint_dismissed';
// "+ 루틴 추가" FAB 위치 기억 — 기본 자리(오른쪽 아래)로부터의 이동량(translateX/Y)을 저장한다
const FAB_POSITION_KEY = 'today_fab_position_v1';
// FAB 이동/초기화 안내 배너 — "다시 보지 않음"을 체크하고 닫아야만 'true'로 저장된다
// v3→v4: 예전 세션 테스트 중 "다시 보지 않음"으로 꺼둔 게 남아있어서 다시 안 뜨던 문제 —
// 버전을 올려서 다시 보이게 함. v4→v5: FAB 탭 동작이 "루틴 추가로 바로 이동"에서 "루틴
// 추가/카테고리 메뉴 펼치기"로 바뀌어서 안내 문구도 같이 바뀜. v5→v6: "말로 루틴
// 추가하기" 위성 버튼 추가로 안내 문구가 또 바뀜(2026-09-22)
const FAB_HINT_DISMISSED_KEY = 'today_fab_hint_dismissed_v6';
const FAB_SIZE = 48;
const FAB_DEFAULT_RIGHT = 16;
const FAB_DEFAULT_BOTTOM = 76;
// 화면 가장자리에서 이만큼은 항상 남기고, 그 밖으로는 못 나가게 한다
const FAB_EDGE_MARGIN = 8;

// FAB를 드래그하는 동안(Gesture.Pan().onUpdate) UI 스레드에서 바로 호출되는 워클릿이라
// 'worklet' 지시어가 필요하다. 화면(컨테이너) 크기를 몰라도(아직 onLayout 전) 일단
// 그대로 통과시키고, 크기를 알게 되면 그때부터 정상적으로 화면 밖을 못 나가게 막는다
function clampFabTranslate(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number } {
  'worklet';
  if (!containerWidth || !containerHeight) return { x, y };
  const minX = FAB_EDGE_MARGIN - containerWidth + FAB_DEFAULT_RIGHT + FAB_SIZE;
  const maxX = FAB_DEFAULT_RIGHT - FAB_EDGE_MARGIN;
  const minY = FAB_EDGE_MARGIN - containerHeight + FAB_DEFAULT_BOTTOM + FAB_SIZE;
  const maxY = FAB_DEFAULT_BOTTOM - FAB_EDGE_MARGIN;
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

// 트래킹 단위(예: "페이지", "잔")를 사용자가 너무 길게 적으면 값+단위가 행을 다 차지해서
// 옆의 루틴 제목이 밀려 안 보이는 문제가 있었다(2026-09-21) — 2글자까지만 보여주고 그 뒤는
// "..."으로 자른다
const TRACKING_UNIT_MAX_CHARS = 2;
function truncateTrackingUnit(unit?: string | null): string {
  if (!unit) return '';
  return unit.length > TRACKING_UNIT_MAX_CHARS ? `${unit.slice(0, TRACKING_UNIT_MAX_CHARS)}...` : unit;
}

// 타임라인 뷰: 시간축에 루틴을 세로로 배치해서 하루 일정을 한눈에 보여줌
function TimelineView({
  routines,
  completions,
  onToggleCheck,
  onEdit,
  onPlayVideo,
  onSkipToday,
  onCancelTracking,
  editingTrackingIds,
  trackingInputs,
  onStartEditTracking,
  onChangeTrackingInput,
  onSaveTracking,
  onFocusTracking,
  onBlurTracking,
  repositionToken,
}: {
  routines: Routine[];
  completions: Record<string, RoutineCompletion>;
  onToggleCheck: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
  onPlayVideo: (videoId: string) => void;
  onSkipToday: (routine: Routine) => void;
  onCancelTracking: (routine: Routine) => void;
  editingTrackingIds: Set<string>;
  trackingInputs: Record<string, string>;
  onStartEditTracking: (routine: Routine) => void;
  onChangeTrackingInput: (routineId: string, text: string) => void;
  onSaveTracking: (routine: Routine) => void;
  onFocusTracking: (routineId: string) => void;
  onBlurTracking: (routineId: string) => void;
  repositionToken: number;
}) {
  const [showSlotHint, setShowSlotHint] = useState(false);
  const [dontShowSlotHintAgain, setDontShowSlotHintAgain] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<number>>(new Set());
  // 스와이프로 연 수정/기록삭제/오늘삭제 버튼을 오늘 탭 리스트뷰와 동일하게 2초 방치하면
  // 자동으로 닫히게 한다(2026-09-21)
  const swipeRefsRef = useRef<Record<string, Swipeable | null>>({});
  const swipeAutoCloseTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 배경(빈 자리) 탭 시 펼친 "+N 더보기" 목록을 접는다. 이 화면 블록들이 전부
  // react-native-gesture-handler 기반 Swipeable이라, 일반 RN Touchable로는 터치를 못 받아서
  // (2026-09-21) 같은 체계인 Gesture.Tap()으로 맞췄다.
  // ⚠️ 처음엔 runOnJS(setExpandedClusters)(new Set())처럼 Set 인스턴스를 워클릿(UI 스레드)에서
  // JS 스레드로 직접 건넸는데, "expandedClusters.has is not a function(undefined)" 렌더
  // 에러가 났다 — Reanimated의 워클릿↔JS 브리지는 원시값/일반 객체만 안전하게 넘기고 Set 같은
  // 내장 클래스 인스턴스는 제대로 안 넘어가는 것으로 보인다. new Set()을 JS 스레드 쪽 함수
  // 안에서 직접 만들도록 바꿔서(인자로는 아무것도 안 넘김) 해결한다
  function collapseExpandedClusters() {
    setExpandedClusters(new Set());
  }
  // 기본 Tap은 손가락이 살짝만 움직여도(약 10px) "탭 실패"로 처리해서 안 접혔다 —
  // 스크롤할 내용이 없어서 실제 스크롤(onScrollBeginDrag)이 안 걸리는 화면에서, 스크롤하듯
  // 문지르기만 해도 접히길 원해서(2026-09-21) maxDistance를 넉넉히 늘려 손을 뗄 때까지는
  // 계속 "탭"으로 인정되게 한다. 실제 스크롤이 되는 경우는 ScrollView가 이 제스처보다 먼저
  // 드래그를 가져가므로(onScrollBeginDrag) 이 값이 커도 스크롤 자체를 방해하지 않는다
  const collapseExpandedClustersTap = Gesture.Tap()
    .maxDistance(200)
    .onEnd((_e, success) => {
      if (success) runOnJS(collapseExpandedClusters)();
    });
  // 타임라인에서 루틴을 탭하면 바로 수정 화면으로 들어가던 걸, 실수로 잘못 눌러도 부담 없게
  // 먼저 간단한 정보만 보여주는 팝업으로 바꿨다 — 여기서 "수정"을 눌러야 실제 수정 화면으로 감
  const [infoRoutine, setInfoRoutine] = useState<Routine | null>(null);
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

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowMinutes >= minHour * 60 && nowMinutes <= maxHour * 60;

  // 루틴이 실제로 걸쳐있는 시간(정시 단위)을 모아서, 그 외의 시간대는 압축 대상으로 삼는다.
  // 시각 체크(순간 체크, 시간을 안 차지함)만 있는 시간은 'instant'(짧게), 실제 소요시간이
  // 있는 루틴이 하나라도 있으면 'full'(꽉 차게) — 한 시간에 둘 다 있으면 'full'이 우선.
  // "지금" 표시선이 압축된 좁은 구간 안에 파묻혀 안 보이면 어색하니, 지금 시각이 속한
  // 시간도 항상 'full'로 넣어둔다
  const hourKinds = new Map<number, HourKind>();
  // 시각 축 라벨을 정시("14:00")가 아니라 그 시간에 실제로 시작/끝나는 루틴이 있으면 그 정확한
  // 시각("14:15")으로 보여주기 위한 맵(hour → "HH:MM"). 예전엔 시작은 블록 안에, 끝은 축에
  // 테마색으로 따로 표시했는데, 정시 눈금("14:00"/"15:00")까지 같이 보여서 숫자가 4개나
  // 보이는 게 헷갈린다는 피드백(2026-09-21) — 정시 눈금 자리 자체를 그 루틴의 실제 시작/끝
  // 시각으로 바꿔서 보여주는 숫자를 줄인다. 같은 시간에 여러 개면 처음 것 하나만 대표로 보여준다
  const hourExactTimeLabel = new Map<number, string>();
  for (const entry of timed) {
    const startH = Math.floor(toMinutes(entry.range.start) / 60);
    const endH = entry.isInstant ? startH : Math.max(startH, Math.ceil(endMinutes(entry.range, false) / 60) - 1);
    const kind: HourKind = entry.isInstant ? 'instant' : 'full';
    for (let h = startH; h <= endH; h++) {
      if (kind === 'full' || hourKinds.get(h) !== 'full') hourKinds.set(h, kind);
    }
    if (!hourExactTimeLabel.has(startH)) hourExactTimeLabel.set(startH, entry.range.start);
    if (!entry.isInstant) {
      const endH2 = Math.floor(endMinutes(entry.range, false) / 60);
      if (!hourExactTimeLabel.has(endH2)) {
        hourExactTimeLabel.set(endH2, entry.range.end <= entry.range.start ? '24:00' : entry.range.end);
      }
      // 끝나는 시각이 정각(예: 08:00)이면 그 루틴은 그 시(8시)를 실제로 전혀 차지하지
      // 않아서 위 hourKinds 루프에 안 잡히고, 빈 시간대 압축 로직에 묻혀 끝 시각 라벨
      // 자체가 안 보이는 버그가 있었다(2026-09-21, "07:00-08:00인데 시작만 나온다") —
      // 그 시(hour)만 별도로 짧게(instant) 확보해서 압축 대상에서 빼고, 정확한 끝
      // 시각이 항상 자기 칸을 갖고 보이게 한다
      if (!hourKinds.has(endH2)) hourKinds.set(endH2, 'instant');
    }
  }
  if (showNowLine) hourKinds.set(Math.floor(nowMinutes / 60), 'full');

  const segments = buildHourSegments(minHour, maxHour, hourKinds);
  const minutesToY = makeMinutesToY(segments, minHour);
  const totalHeight = segments.reduce((sum, s) => sum + s.pixelHeight, 0);

  const nowTop = minutesToY(nowMinutes);

  // 'instant' 세그먼트는 압축된 고정 높이(36px)라 그 시간의 정확한 "분"에 비례해서
  // (minutesToY로) 위치를 잡으면, 블록 자기 키(34px)가 그 좁은 칸보다 커서 시(hour)의
  // 뒤쪽 절반에 걸리는 시각체크일수록 다음 시간대까지 밀려 내려가 겹쳐 보이는 문제가 있었다
  // (예: 22:30분 시각체크가 22:00~23:00 두 칸에 걸쳐 보임) — 시각체크 블록은 "그 시각이 정확히
  // 몇 분인지"를 칸 안에서 비례로 보여줄 필요가 없으므로, 정확한 분 대신 그 시간 칸(세그먼트)
  // 안에서 그냥 세로 가운데에 고정해서 절대 다음 칸을 침범하지 않게 한다
  const instantSegmentTopByHour = new Map<number, number>();
  {
    let cursor = 0;
    for (const seg of segments) {
      if (seg.hourSpan === 1) instantSegmentTopByHour.set(seg.hour, cursor);
      cursor += seg.pixelHeight;
    }
  }

  // 같은 시간대에 여러 개 몰려도 쌓지 않고 각자 블록으로 만들어서, 아래 컬럼 배치 로직이 옆으로 나란히 놓는다
  const blocks: TimelineBlock[] = timed.map((entry) => {
    const { routine, range, isExact, isInstant } = entry;
    const key = isExact ? `exact-${routine.id}` : `slot-${routine.id}`;
    const height = isInstant ? 34 : Math.max((endMinutes(range, false) - toMinutes(range.start)) * (HOUR_HEIGHT / 60), 34);
    let top: number;
    if (isInstant) {
      const hour = Math.floor(toMinutes(range.start) / 60);
      const segTop = instantSegmentTopByHour.get(hour);
      const segHeight = hourKinds.get(hour) === 'instant' ? INSTANT_HOUR_HEIGHT : HOUR_HEIGHT;
      top = segTop !== undefined ? segTop + Math.max(0, (segHeight - height) / 2) : minutesToY(toMinutes(range.start));
    } else {
      // 루틴이 실제로 차지하는 시간대는 정의상 압축 대상이 아니므로(hourKinds에 'full'로 들어있음)
      // 그 구간 안에서는 항상 기존과 같은 "분당 HOUR_HEIGHT/60px" 비율이 그대로 유지된다
      top = minutesToY(toMinutes(range.start));
    }
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
    const routine = block.items[0].routine;
    const isInstant = block.items[0].isInstant;
    const isNowBlock = isNowWithinRange(block.items[0].range, isInstant);
    const blockCompletion = completions[routine.id];
    const isBlockDone = Boolean(blockCompletion);
    // 배경(빈 자리) 탭으로만 "+N 더보기" 목록이 닫혀서, 다른 루틴을 눌러도 안 닫힌다는
    // 피드백(2026-09-21) — 지금 펼쳐진 목록 소속이 아닌 블록을 누르면(체크/제목/트래킹 등
    // 실제 동작과 함께) 그 목록도 같이 접는다. 펼쳐진 목록 "안"의 항목(pos.expanded)을 누를
    // 땐 계속 그 목록을 보면서 여러 개 체크할 수 있어야 하므로 안 접는다
    const collapseFirstIfNeeded = () => {
      if (!pos.expanded && expandedClusters.size > 0) setExpandedClusters(new Set());
    };
    return (
      <Swipeable
        key={block.key}
        ref={(instance) => {
          swipeRefsRef.current[block.key] = instance;
        }}
        onSwipeableOpen={() => {
          clearTimeout(swipeAutoCloseTimersRef.current[block.key]);
          swipeAutoCloseTimersRef.current[block.key] = setTimeout(() => {
            swipeRefsRef.current[block.key]?.close();
          }, 1500);
        }}
        onSwipeableClose={() => {
          clearTimeout(swipeAutoCloseTimersRef.current[block.key]);
          delete swipeAutoCloseTimersRef.current[block.key];
        }}
        containerStyle={{
          position: 'absolute',
          top: pos.top,
          height: pos.height,
          left: pos.left,
          width: pos.width,
          // "더보기"로 펼친 목록은 원래 시간 위치와 무관하게 겹쳐 그려지므로, 그 자리에 먼저
          // 깔아둔 불투명 배경판(blockExpanded, zIndex:10)보다 위에 있어야 하는데, 이 zIndex를
          // 블록 안쪽(Swipeable이 감싼 내부 View)에만 줬을 땐 정작 형제 관계로 겹치는 건
          // Swipeable 자기 자신(바깥 컨테이너)이라 안쪽 zIndex가 반영되지 않아 배경판에 가려져
          // 파란 배경만 보이고 글자/체크박스가 안 보이는 버그가 있었다(2026-09-21)
          ...(pos.expanded ? { zIndex: 10, elevation: 4 } : null),
        }}
        overshootRight={false}
        renderRightActions={() => (
          <View style={timelineStyles.blockSwipeActionsRow}>
            <AnimatedPressable style={timelineStyles.blockEditAction} onPress={() => onEdit(routine)}>
              <Text style={timelineStyles.blockEditActionText}>{t('today.edit')}</Text>
            </AnimatedPressable>
            {routine.block_type === 'tracking' && isBlockDone && (
              <AnimatedPressable
                style={timelineStyles.blockCancelTrackingAction}
                onPress={() => onCancelTracking(routine)}>
                <Text style={timelineStyles.blockEditActionText}>{t('today.cancelRecord')}</Text>
              </AnimatedPressable>
            )}
            <AnimatedPressable style={timelineStyles.blockDeleteAction} onPress={() => onSkipToday(routine)}>
              <Text style={timelineStyles.blockDeleteActionText}>{t('today.skipToday')}</Text>
            </AnimatedPressable>
          </View>
        )}>
      <View
        style={[
          timelineStyles.block,
          // Swipeable의 containerStyle이 이미 위치(top/left)와 크기(width/height)를 절대값으로
          // 잡아주므로, 안쪽 블록은 그 안을 꽉 채우기만 하면 된다 — block 스타일에 남아있는
          // position:'absolute'를 그대로 두면 이 View 자신은 크기 기준(top/left)이 없어 내용물
          // 크기로 쪼그라들어서, 제목/시간/버튼이 한 지점에 겹쳐 보이는 버그가 있었다(2026-09-21)
          timelineStyles.blockFill,
          isNowBlock && timelineStyles.blockNow,
          pos.expanded && timelineStyles.blockExpanded,
        ]}>
        {block.items.map(({ routine }, index) => {
          const completion = completions[routine.id];
          const isDone = Boolean(completion);
          return (
            <View key={routine.id} style={[timelineStyles.blockRow, isDone && timelineStyles.blockRowDone]}>
              <AnimatedPressable
                style={timelineStyles.blockContent}
                onPress={() => {
                  collapseFirstIfNeeded();
                  setInfoRoutine(routine);
                }}>
                {pos.showTime && index === 0 && (
                  // 블록 안엔 시작 시각만 짧게 표시 — 끝나는 시각은 왼쪽 시간축의 해당 정시
                  // 라벨 자리를 그대로 대신해서 보여준다(hourExactTimeLabel 참고). 시각 체크(⏱)는
                  // 시작~끝이 있는 일반 시각형과 달리 "그 순간 하나"만 있다는 걸 알기 어려워서
                  // 이모지로 구분해준다
                  <Text style={[timelineStyles.blockTime, pos.expanded && timelineStyles.blockTextExpanded]}>
                    {isInstant ? '⏱ ' : ''}
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
              {routine.video_id && (
                <AnimatedPressable
                  hitSlop={6}
                  style={timelineStyles.blockPlayButton}
                  onPress={() => onPlayVideo(routine.video_id!)}>
                  <Text style={timelineStyles.blockPlayButtonText}>▶</Text>
                </AnimatedPressable>
              )}
              {routine.block_type === 'check' ? (
                <AnimatedPressable
                  hitSlop={8}
                  style={[timelineStyles.blockCheckbox, isDone && timelineStyles.blockCheckboxDone]}
                  onPress={() => {
                    collapseFirstIfNeeded();
                    onToggleCheck(routine);
                  }}>
                  {isDone && <Text style={timelineStyles.blockCheckmark}>✓</Text>}
                </AnimatedPressable>
              ) : editingTrackingIds.has(routine.id) ? (
                // 타임라인에선 그동안 값을 보여주기만 하고 실제로 적을 방법이 없었다(2026-09-21) —
                // 오늘 탭 리스트뷰와 같은 입력 상태(trackingInputs 등)를 그대로 공유해서, 숫자
                // 키패드의 "완료"를 누르면 저장되게 한다
                <TextInput
                  style={timelineStyles.blockTrackingInput}
                  keyboardType="numeric"
                  value={trackingInputs[routine.id] ?? ''}
                  onChangeText={(text) => onChangeTrackingInput(routine.id, text)}
                  onFocus={() => onFocusTracking(routine.id)}
                  onBlur={() => onBlurTracking(routine.id)}
                  onSubmitEditing={() => onSaveTracking(routine)}
                  placeholder="0"
                  autoFocus
                />
              ) : (
                <AnimatedPressable
                  onPress={() => {
                    collapseFirstIfNeeded();
                    onStartEditTracking(routine);
                  }}>
                  <Text
                    style={[timelineStyles.blockTrackingValue, pos.expanded && timelineStyles.blockTextExpanded]}>
                    {completion?.tracking_value ?? '-'} {truncateTrackingUnit(routine.tracking_unit)}
                  </Text>
                </AnimatedPressable>
              )}
            </View>
          );
        })}
      </View>
      </Swipeable>
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
        // 루틴이 적어서 콘텐츠(totalHeight)가 화면보다 짧으면, 화면에 보이는 아래쪽 흰 여백은
        // 스크롤뷰의 "콘텐츠 영역" 밖이라 그 안의 배경 탭 제스처가 아예 닿지 않았다(2026-09-21)
        // — flexGrow로 콘텐츠 영역 자체를 화면 높이만큼 늘려서 그 여백도 탭 가능하게 한다
        contentContainerStyle={{ minHeight: totalHeight + 20, flexGrow: 1 }}
        onScrollBeginDrag={() => {
          if (expandedClusters.size > 0) setExpandedClusters(new Set());
        }}>
      {/* 자식들이 전부 position:absolute라서 이 View에 실제 크기를 안 주면 0x0으로 잡혀
          제스처가 인식할 영역 자체가 없어져 탭이 전혀 안 먹히는 문제가 있었다(2026-09-21) —
          minHeight+flex:1로 콘텐츠 영역(위 contentContainerStyle과 동일하게 늘어난 만큼)
          전체를 채워서 루틴 없는 흰 배경까지 전부 탭 가능하게 한다 */}
      <View style={{ width: '100%', minHeight: totalHeight, flex: 1 }}>
      {/* "+N 더보기"로 펼친 목록을 스크롤하면 닫히던 것과 같은 이유로, 빈 자리를 탭해도 닫히게
          하고 싶었는데, 이 화면은 블록마다 Swipeable(react-native-gesture-handler)을 쓰고 있어서
          일반 RN Touchable(TouchableWithoutFeedback)로 배경을 감싸면 제스처 체계가 달라 터치를
          아예 못 받는 문제가 있었다(2026-09-21) — 사진일기 화면의 배경 탭 해제와 동일하게
          같은 gesture-handler 체계의 Gesture.Tap()으로 통일해서 해결한다. 단, 펼친 목록의
          체크박스/트래킹 입력처럼 실제 눌러야 하는 요소까지 이 감지 영역 "안"에 있으면 같은
          터치가 두 체계(RNGH 제스처 + 일반 Pressable) 양쪽에서 동시에 인식돼, 체크/입력을
          누르는데도 배경 탭으로 오인되어 목록이 접혀버리는 버그가 있었다(2026-09-21) —
          블록들(blocksArea)은 이 GestureDetector "밖"으로 빼서 위에 별도 레이어로 얹고,
          배경 감지는 그 밑에 깔린 축/빈 공간에만 걸리게 분리했다 */}
      <GestureDetector gesture={collapseExpandedClustersTap}>
      <View style={{ width: '100%', height: '100%' }}>
      {(() => {
        let cursor = 0;
        return segments.map((seg) => {
          const segTop = cursor;
          cursor += seg.pixelHeight;
          // 루틴 있는 시간(또는 짧은 공백)은 기존처럼 매 정시마다 눈금선+시각 표시
          if (seg.hourSpan === 1) {
            // 이 시간에 시작하거나 끝나는 루틴이 있으면 정시("14:00") 대신 그 정확한 시각
            // ("14:15")을 축 라벨로 보여준다 — 정시 눈금 + 블록 시작 + 테마색 끝 표시까지
            // 숫자가 3~4개나 보여서 헷갈린다는 피드백으로, 끝 표시를 따로 안 두고 이 정시
            // 눈금 자리 자체를 정확한 시각으로 바꿔서 숫자 개수를 줄였다(2026-09-21)
            const exactTime = hourExactTimeLabel.get(seg.hour);
            return (
              <Fragment key={seg.hour}>
                <View style={[timelineStyles.hourLine, { top: segTop }]} />
                <View style={[timelineStyles.hourLabelWrap, { top: segTop - 7 }]}>
                  <Text style={timelineStyles.hourLabel}>
                    {exactTime ? formatTime(exactTime) : `${String(seg.hour).padStart(2, '0')}:00`}
                  </Text>
                </View>
              </Fragment>
            );
          }
          // 루틴이 한참 없는 구간은 정시마다 다 그리지 않고, 그 범위를 알려주는 얇은 띠 하나로 압축
          return (
            <View key={seg.hour} style={[timelineStyles.gapBand, { top: segTop, height: seg.pixelHeight }]}>
              <Text style={timelineStyles.gapBandText}>
                {String(seg.hour).padStart(2, '0')}~{String(seg.hour + seg.hourSpan).padStart(2, '0')}시
              </Text>
            </View>
          );
        });
      })()}

      {showNowLine && <View style={[timelineStyles.nowLine, { top: nowTop - 1 }]} pointerEvents="none" />}
      </View>
      </GestureDetector>

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
                {/* 접힌 상태에서 보이는 블록은 하나뿐이라 시간 표시가 중복되지 않는다 — 펼쳤을
                    때(같은 슬롯 시각이 여러 번 반복되는 목록)만 showTime을 꺼서 중복을 없앤다.
                    이걸 여기서도 꺼두면 "아침/점심/저녁"처럼 슬롯에 루틴이 여럿 몰린 경우
                    시작 시각 자체가 아예 안 보이는 버그가 있었음 */}
                {renderBlock(first, { top: clusterTop, height: first.height, left: '0%', width: '80%', showTime: true })}
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
      </View>
      </ScrollView>

      <Modal visible={!!infoRoutine} transparent animationType="fade" onRequestClose={() => setInfoRoutine(null)}>
        <View style={timelineStyles.infoBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setInfoRoutine(null)} />
          {infoRoutine && (
            <ShadowCard style={timelineStyles.infoCardOuter} contentStyle={timelineStyles.infoCard}>
              <Text style={timelineStyles.infoTitle}>{infoRoutine.title}</Text>
              <View style={timelineStyles.infoBadgeRow}>
                <View style={timelineStyles.infoBadge}>
                  <Text style={timelineStyles.infoBadgeText}>
                    {infoRoutine.block_type === 'check' ? t('common.check') : t('common.tracking')}
                  </Text>
                </View>
                <View style={timelineStyles.infoBadge}>
                  <Text style={timelineStyles.infoBadgeText}>{repeatLabel(infoRoutine, t)}</Text>
                </View>
                {infoRoutine.is_required && (
                  <View style={[timelineStyles.infoBadge, timelineStyles.infoBadgeAccent]}>
                    <Text style={[timelineStyles.infoBadgeText, timelineStyles.infoBadgeTextAccent]}>*필수</Text>
                  </View>
                )}
                {infoRoutine.skip_holidays && (
                  <View style={[timelineStyles.infoBadge, timelineStyles.infoBadgeAccent]}>
                    <Text style={[timelineStyles.infoBadgeText, timelineStyles.infoBadgeTextAccent]}>공휴일 제외</Text>
                  </View>
                )}
              </View>
              <Text style={timelineStyles.infoTime}>{timeLabel(infoRoutine, t)}</Text>
              {(() => {
                const infoCompletion = completions[infoRoutine.id];
                if (!infoCompletion) return null;
                return (
                  <Text style={timelineStyles.infoStatusDone}>
                    ✓ 완료
                    {infoRoutine.block_type === 'tracking' &&
                      infoCompletion.tracking_value != null &&
                      ` · ${infoCompletion.tracking_value} ${truncateTrackingUnit(infoRoutine.tracking_unit)}`}
                  </Text>
                );
              })()}
              {infoRoutine.memo && (
                <View style={timelineStyles.infoMemoCard}>
                  {/* 메모가 너무 길면 팝업 박스 자체가 한없이 커지니 5줄까지만 보여주고 나머진 ... */}
                  <Text style={timelineStyles.infoMemo} numberOfLines={5} ellipsizeMode="tail">
                    {infoRoutine.memo}
                  </Text>
                </View>
              )}
              <View style={timelineStyles.infoButtonRow}>
                <AnimatedPressable style={timelineStyles.infoCloseButton} onPress={() => setInfoRoutine(null)}>
                  <Text style={timelineStyles.infoCloseText}>{t('today.close')}</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={timelineStyles.infoEditButton}
                  onPress={() => {
                    const routine = infoRoutine;
                    setInfoRoutine(null);
                    onEdit(routine);
                  }}>
                  <Text style={timelineStyles.infoEditText}>{t('today.edit')}</Text>
                </AnimatedPressable>
              </View>
            </ShadowCard>
          )}
        </View>
      </Modal>
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
  // 루틴이 없는 시간대를 압축해서 보여주는 얇은 띠 — 일반 시간 칸(HOUR_HEIGHT)보다 훨씬 얇게
  gapBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(26,26,26,0.08)',
  },
  gapBandText: {
    fontSize: 10,
    opacity: 0.35,
  },
  blocksArea: {
    position: 'absolute',
    left: 69,
    right: 0,
    top: 0,
    bottom: 0,
  },
  // 배경을 반투명(rgba)으로 쓰면 평소엔 은은한 색으로 잘 보이지만, 스와이프를 닫는 애니메이션
  // 동안엔 그 뒤에서 슬라이드되어 빠져나가는 "수정/삭제" 버튼 색이 이 반투명 배경 사이로
  // 비쳐 보이는 문제가 있었다(2026-09-21) — 흰 배경 위에 이 반투명색을 얹었을 때와 눈으로
  // 똑같이 보이는 불투명(opaque) 색을 미리 계산해서 대신 쓴다(rgba(169,196,224,0.12) on white)
  block: {
    position: 'absolute',
    backgroundColor: 'rgb(245, 248, 251)',
    borderLeftWidth: 3,
    borderLeftColor: accent,
    borderRadius: cardRadius,
    overflow: 'hidden',
  },
  // Swipeable로 감싼 블록 전용 — 바깥 Swipeable의 containerStyle이 이미 절대 위치/크기를
  // 잡아주므로, 안쪽 View는 position:'absolute'를 relative로 되돌리고 부모(Swipeable이 감싼
  // 영역)를 꽉 채우기만 하면 된다
  blockFill: {
    position: 'relative',
    width: '100%',
    height: '100%',
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
  // block과 같은 이유로 불투명 색으로 미리 계산(rgba(255,152,0,0.18) on white)
  blockNow: {
    backgroundColor: 'rgb(255, 236, 209)',
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
  // 고정폭(36px)이 "22:15"에는 딱 맞았지만 ⏱ 이모지를 붙이면 폭이 모자라서 다음 줄로
  // 넘어가(제목이 있어야 할 자리를 이모지+시각 두 줄이 차지) 시각이 안 보이던 버그(2026-09-21)
  // — 고정폭 대신 내용 그대로의 너비를 쓰게 해서 이모지가 붙어도 한 줄에 다 들어가게 한다
  blockTime: {
    fontSize: 11,
    opacity: 0.6,
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
  blockPlayButton: {
    paddingHorizontal: 4,
  },
  blockPlayButtonText: {
    fontSize: 11,
    color: accent,
  },
  // 리스트뷰의 스와이프(수정/기록삭제/오늘삭제)와 같은 구성 — 타임라인에서도 왼쪽으로
  // 스와이프하면 동일하게 나옴(기록삭제는 트래킹형이면서 완료된 경우에만 표시)
  blockSwipeActionsRow: {
    flexDirection: 'row',
    gap: 4,
    height: '100%',
  },
  blockEditAction: {
    backgroundColor: withAlpha(accent, 0.15),
    justifyContent: 'center',
    alignItems: 'center',
    width: 56,
    borderRadius: cardRadius,
  },
  blockEditActionText: {
    color: accent,
    fontSize: 11,
    fontWeight: '600',
  },
  blockCancelTrackingAction: {
    backgroundColor: withAlpha(accent, 0.3),
    justifyContent: 'center',
    alignItems: 'center',
    width: 56,
    borderRadius: cardRadius,
  },
  blockDeleteAction: {
    backgroundColor: accent,
    justifyContent: 'center',
    alignItems: 'center',
    width: 56,
    borderRadius: cardRadius,
  },
  blockDeleteActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
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
  blockTrackingInput: {
    width: 40,
    fontSize: 12,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    textAlign: 'center',
  },
  // 타임라인에서 루틴을 탭하면 바로 수정 화면으로 넘어가는 대신 뜨는 간단설명 팝업
  infoBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 32,
  },
  infoCardOuter: {
    width: '100%',
  },
  infoCard: {
    padding: 24,
  },
  infoTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  infoBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  infoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: border,
  },
  infoBadgeText: {
    fontSize: 11,
    opacity: 0.6,
  },
  // 필수/공휴일 제외처럼 눈에 띄어야 하는 뱃지만 테마색으로 채워서 구분
  infoBadgeAccent: {
    backgroundColor: accent,
    borderColor: accent,
  },
  infoBadgeTextAccent: {
    color: '#fff',
    opacity: 1,
    fontWeight: '600',
  },
  infoTime: {
    fontSize: 14,
    opacity: 0.6,
    fontFamily: fontMono,
  },
  infoStatusDone: {
    fontSize: 13,
    fontWeight: '600',
    color: accent,
    marginTop: 6,
  },
  // 메모는 그냥 글자만 놓기보다 포스트잇처럼 살짝 구분된 카드로 보여줘서 "깔끔한 메모"
  // 느낌을 준다(캘린더 날짜 메모 카드와 같은 톤)
  infoMemoCard: {
    marginTop: 12,
    padding: 10,
    borderRadius: cardRadius,
    backgroundColor: withAlpha(accent, 0.08),
  },
  infoMemo: {
    fontSize: 13,
    opacity: 0.8,
    lineHeight: 18,
  },
  infoButtonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 20,
  },
  infoCloseButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: border,
  },
  infoCloseText: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.6,
  },
  infoEditButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    backgroundColor: accent,
  },
  infoEditText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
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
        }, 1500);
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
                  ✓ {completion?.tracking_value} {truncateTrackingUnit(item.tracking_unit)}
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
                  // 화면을 깔끔하게 하려고 별도 "저장" 버튼을 없애고, 숫자 키패드의 완료 키를
                  // 누르면 바로 저장되게 한다(안드로이드/iOS 숫자 키패드는 기본이 "완료"라
                  // returnKeyType을 따로 안 줘도 됨)
                  onSubmitEditing={() => onSaveTracking(item)}
                  placeholder="0"
                  autoFocus={isDone}
                />
                <Text style={styles.unit} numberOfLines={1}>
                  {truncateTrackingUnit(item.tracking_unit)}
                </Text>
                {isDone && (
                  <AnimatedPressable style={styles.cancelTrackingButton} onPress={() => onCloseEditTracking(item.id)}>
                    <Text style={styles.cancelTrackingButtonText}>{t('today.close')}</Text>
                  </AnimatedPressable>
                )}
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

  // "+ 루틴 추가" FAB를 길게 눌러서 원하는 자리로 옮길 수 있게 한다(2026-09-21) — 화면 크기에
  // 관계없이 항상 화면 밖으로는 못 나가게 clampFabTranslate로 가장자리에서 최소 8px은 남긴다.
  // 위치는 기본(오른쪽 아래) 자리로부터의 이동량(translateX/Y)으로 저장 — 짧게 탭하면 루틴
  // 추가, 두 번 연속 탭하면 기본 위치로 돌아온다. Swipeable(react-native-gesture-handler)이
  // 이미 화면 곳곳에 있는 화면이라, 일반 RN Touchable/PanResponder 대신 같은 체계인
  // Gesture(react-native-gesture-handler)로 통일해서 터치 인식 충돌을 피한다
  const fabTranslateX = useSharedValue(0);
  const fabTranslateY = useSharedValue(0);
  const fabDragStartX = useSharedValue(0);
  const fabDragStartY = useSharedValue(0);
  const fabContainerWidth = useSharedValue(0);
  const fabContainerHeight = useSharedValue(0);

  useEffect(() => {
    AsyncStorage.getItem(FAB_POSITION_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          fabTranslateX.value = parsed.x;
          fabTranslateY.value = parsed.y;
        }
      } catch {
        // 저장된 값이 깨져 있으면 그냥 기본 위치로 둔다
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "길게 눌러서 옮기고, 두 번 탭하면 초기화" 안내 — 처음엔 배경을 테마 주색(accent)으로
  // 채웠다가 밝고 옅은 테마(은은한 노랑/세이지그린/로즈)에서 흰 글씨가 안 보이는 버그를
  // 겪었고, 그다음 어두운 고정 배경으로 바꿨다가 "너무 칙칙하다"는 피드백을 받았다 —
  // 최종적으로 설정 화면 회원탈퇴 안내(deleteAccountTooltip)와 같은 패턴으로 통일: 배경은
  // 항상 불투명한 흰색으로 고정하고 테마 주색은 테두리·아이콘·글자·닫기 버튼에만 입혀서,
  // 어떤 테마색을 골라도 흰 배경 위 텍스트라 대비가 항상 안정적으로 확보된다(2026-09-21)
  // "다시 보지 않음"을 체크하고 닫아야만 다음부터 안 뜨고, 그냥 "닫기"만 누르면 다음에
  // 오늘 탭에 들어올 때 다시 뜬다. 시간이 지나면 자동으로 사라지게 했었는데(15초), "사용자가
  // 닫기 누르기 전까진 계속 보이는 게 낫겠다"는 피드백으로 자동 사라짐을 없앴다(2026-09-22)
  const [showFabHint, setShowFabHint] = useState(false);
  const [dontShowFabHintAgain, setDontShowFabHintAgain] = useState(false);

  // 마운트 시 1회만 실행되면, 회원탈퇴 후 재가입처럼 앱을 껐다 켜지 않고 로그인만 다시
  // 하는 경우엔 이 오늘 탭 화면 자체가 다시 마운트되지 않아서(스택 최하단 화면이라 계속
  // 살아있음) 안내가 다시 안 뜨는 문제가 있었다 — userId가 바뀔 때마다(로그아웃→로그인,
  // 탈퇴→재가입 포함) 다시 실행되도록 의존성을 추가했다(2026-09-22)
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    AsyncStorage.getItem(FAB_HINT_DISMISSED_KEY).then((dismissedForever) => {
      if (cancelled || dismissedForever === 'true') return;
      setShowFabHint(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const hideFabHint = useCallback(() => {
    setShowFabHint(false);
  }, []);

  async function closeFabHint() {
    hideFabHint();
    if (dontShowFabHintAgain) await AsyncStorage.setItem(FAB_HINT_DISMISSED_KEY, 'true');
  }

  function persistFabPosition(x: number, y: number) {
    AsyncStorage.setItem(FAB_POSITION_KEY, JSON.stringify({ x, y }));
  }

  function resetFabPosition() {
    fabTranslateX.value = withSpring(0);
    fabTranslateY.value = withSpring(0);
    persistFabPosition(0, 0);
  }

  function openAddRoutine() {
    router.push('/routine-form');
  }

  // 예전엔 FAB를 탭하면 바로 루틴 추가로 이동했는데(2026-09-21), 헤더에 따로 있던
  // 영상/일기/모음집/내 루틴 4개 버튼을 여기로 합치면서(2026-09-22) FAB를 탭하면 "루틴
  // 추가"/"카테고리" 두 개의 작은 원(위성 버튼)이 위로 펼쳐지도록 바꿨다. "카테고리"를
  // 누르면 그 4개 목록이 뜨는 바텀시트가 열린다
  const fabExpandProgress = useSharedValue(0);
  const [fabExpanded, setFabExpanded] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  // 펼침 효과가 스프링(통통 튀는 느낌)이라 과하다는 피드백(2026-09-22) — 튀지 않는
  // 단순한 timing으로 바꾸고, 아래 위성 버튼의 확대/회전 폭도 같이 줄였다.
  // ⚠️ setFabExpanded의 함수형 업데이터 안에서 fabExpandProgress.value를 같이 바꾸던 것을
  // (부수효과가 업데이터 함수 안에 있어서 호출 횟수를 신뢰할 수 없었음) 지금 렌더의
  // fabExpanded 값을 그대로 읽는 방식으로 단순화 — "처음 눌렀을 때만 이상하게 동작한다"는
  // 신고(2026-09-22)의 유력한 원인 중 하나로 보고 정리
  function toggleFabExpanded() {
    const next = !fabExpanded;
    setFabExpanded(next);
    fabExpandProgress.value = withTiming(next ? 1 : 0, { duration: 160 });
  }

  const collapseFab = useCallback(() => {
    setFabExpanded(false);
    fabExpandProgress.value = withTiming(0, { duration: 160 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAddRoutinePress() {
    collapseFab();
    openAddRoutine();
  }

  // "말로 루틴 추가하기" 배너(llmBanner)와 같은 목적지 — 아래쪽 배너는 남은 사용 횟수까지
  // 보여주는 정보성 카드라 그대로 두고, FAB에서도 빠르게 갈 수 있게 위성 버튼을 추가한다
  // (2026-09-22)
  function handleLlmInputPress() {
    collapseFab();
    router.push('/llm-input');
  }

  function handleCategoryPress() {
    collapseFab();
    setShowCategoryMenu(true);
  }

  // 바텀시트가 닫히는 애니메이션과 다음 화면이 뜨는 애니메이션이 동시에 겹치면 버벅였다
  // (2026-09-22, "+ 버튼 후 일기장 열 때 렉" 신고로 확인) — 시트를 먼저 완전히 닫고,
  // 그 애니메이션이 끝난 뒤에 이동하도록 살짝 지연을 둔다
  function navigateAfterCategoryMenuCloses(action: () => void) {
    setShowCategoryMenu(false);
    setTimeout(action, 300);
  }

  function goToCategory(pathname: '/videos' | '/presets' | '/my-routines') {
    navigateAfterCategoryMenuCloses(() => router.push(pathname));
  }

  function goToTodayDiary() {
    navigateAfterCategoryMenuCloses(() =>
      router.push({ pathname: '/diary-form', params: { date: formatLocalDate(new Date()) } })
    );
  }

  // ⚠️ Gesture.Tap().numberOfTaps(2) + requireExternalGestureToFail로 싱글탭/더블탭을
  // 구분하려던 첫 시도는 "+" 버튼을 누르는 순간 에러가 났다 — 이어서 그 relation 하나를
  // 지워봤는데도(2026-09-21 이전 수정) 여전히 에러가 남아있었다. react-native-gesture-handler의
  // 제스처 관계 설정(Exclusive/requireToFail) 자체가 문제였던 것으로 보고, 아예 그 방식을
  // 버리고 이 화면의 다른 제스처들처럼 단순한 방식으로 바꾼다: 탭 자체는 순수 JS 타이머로
  // "직전 탭과 300ms 안이면 더블탭"만 판정하고, 길게 누르기+드래그(fabPan)만 제스처로 처리해서
  // Race로 묶는다(사진일기 화면에서 이미 검증된 조합 — Gesture.Race(pan, ..., singleTap))
  // ⚠️ "탭하면 메뉴 펼치기"로 바뀌기 전엔 싱글탭 액션(루틴 추가 이동)을 300ms 지연시켰다가
  // 그사이 두 번째 탭이 없으면 실행하는 방식이었다 — 화면 전환이라 지연이 크게 안 느껴졌는데,
  // 지금은 "그 자리에서 바로 펼쳐지는" 반응이라 이 지연이 그대로 "첫 클릭이 안 먹히는"
  // 것처럼 느껴지고, 딜레이 중에 답답해서 급하게 다시 누르면 더블탭으로 판정돼 펼치기 자체가
  // 취소되는 버그로 이어졌다(2026-09-22, "처음 눌렀을 때 이상하게 돌아가고 두 번째 눌러야
  // 실행된다"로 확인) — 싱글탭은 지연 없이 즉시 펼치고, "300ms 안에 또 눌렀다"는 것만
  // 감지해서 위치 초기화를 추가로 실행하는 방식으로 바꿨다(두 번 탭하면 펼침이 두 번
  // 토글돼 도로 접히면서 위치도 초기화됨 — 원래 의도한 "두 번 탭 = 초기화" 결과는 그대로)
  const fabLastTapAtRef = useRef(0);

  function handleFabTap() {
    const now = Date.now();
    const sinceLastTap = now - fabLastTapAtRef.current;
    fabLastTapAtRef.current = now;
    toggleFabExpanded();
    if (sinceLastTap < 300) {
      fabLastTapAtRef.current = 0;
      resetFabPosition();
    }
  }

  const fabPan = Gesture.Pan()
    .activateAfterLongPress(400)
    .onStart(() => {
      fabDragStartX.value = fabTranslateX.value;
      fabDragStartY.value = fabTranslateY.value;
      runOnJS(hideFabHint)();
      runOnJS(collapseFab)();
    })
    .onUpdate((e) => {
      const clamped = clampFabTranslate(
        fabDragStartX.value + e.translationX,
        fabDragStartY.value + e.translationY,
        fabContainerWidth.value,
        fabContainerHeight.value
      );
      fabTranslateX.value = clamped.x;
      fabTranslateY.value = clamped.y;
    })
    .onEnd(() => {
      runOnJS(persistFabPosition)(fabTranslateX.value, fabTranslateY.value);
    });

  const fabTap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(handleFabTap)();
  });

  const fabGesture = Gesture.Race(fabPan, fabTap);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fabTranslateX.value }, { translateY: fabTranslateY.value }],
  }));

  // "+"를 눌렀을 때 살짝만 회전해서 펼쳐진 상태라는 힌트만 주는 정도로 — 45도까지 크게
  // 돌리니 효과가 과하다는 피드백(2026-09-22)으로 18도로 줄임
  const fabMainIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabExpandProgress.value * 18}deg` }],
  }));
  // 위성 버튼 세 개(루틴 추가·말로 루틴 추가하기·카테고리)는 FAB의 드래그 위치
  // (fabTranslateX/Y)를 따라가며 각자 정해진 자리에 뜬다. 순서는 "제일 많이 쓸 걸
  // FAB에서 가장 가깝게"라는 기준으로 정했다 — 카테고리가 가장 가깝고(먼저 손이 닿게),
  // 말로 루틴 추가하기가 그 위, 루틴 추가가 맨 위(2026-09-22, 처음엔 반대 순서였는데
  // "카테고리를 제일 많이 쓸 거니까 가장 가깝게"라는 요청으로 뒤집었다)
  // ⚠️ 처음엔 translateY 자체를 fabExpandProgress로 곱해서 "FAB 위치에서부터 떠오르며
  // 나타나는" 연출이었는데, 그러면 접혀 있을 때(progress=0) 위성 세 개가 전부 FAB와
  // 똑같은 자리에 겹쳐 있게 되고, pointerEvents가 'none'→'auto'로 바뀌는 시점과 실제로
  // 제자리로 다 떠오르는 시점 사이에 시간차가 생겨서, 그 짧은 순간 FAB를 눌러도 그
  // 자리에 겹쳐 있던(맨 위 zIndex인) "카테고리" 위성이 대신 눌리는 버그가 있었다
  // (2026-09-22, "+ 한 번 눌러선 안 되고 한 번 더 눌러야 카테고리가 열림"으로 확인) —
  // 자리는 항상 고정해두고 scale만 애니메이션한다.
  // ⚠️ opacity도 같이 애니메이션했었는데, 안드로이드의 elevation(그림자)은 View 자체의
  // opacity 애니메이션과 같이 안 옅어지고 먼저 다 보여버리는 경우가 있어서 "그림자만
  // 먼저 보이고 글자는 하얗게 비어 보인다"는 버그로 이어졌다(2026-09-22) — opacity
  // 애니메이션을 없애고, 대신 fabExpanded가 true일 때만 위성을 아예 화면에 그리도록
  // (JSX에서 조건부 렌더링) 바꿔서 "반투명하게 걸쳐 있는" 중간 상태 자체를 없앴다.
  // 각 함수는 useAnimatedStyle에 직접 넘기는 워클릿 안에서 .value를 곧바로 읽는다 —
  // 별도 헬퍼 함수를 거치면(이전 방식) reanimated가 의존성을 못 잡아서 첫 번째 갱신만
  // 반영이 안 되는 것처럼 보이는 사례가 있어(2026-09-22) 각자 인라인으로 풀어썼다
  const fabCategorySatelliteStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: fabTranslateX.value },
      { translateY: fabTranslateY.value - (FAB_SIZE + 14) },
      { scale: 0.85 + 0.15 * fabExpandProgress.value },
    ],
  }));
  const fabLlmInputSatelliteStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: fabTranslateX.value },
      { translateY: fabTranslateY.value - (FAB_SIZE + 14) * 2 },
      { scale: 0.85 + 0.15 * fabExpandProgress.value },
    ],
  }));
  const fabRoutineSatelliteStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: fabTranslateX.value },
      { translateY: fabTranslateY.value - (FAB_SIZE + 14) * 3 },
      { scale: 0.85 + 0.15 * fabExpandProgress.value },
    ],
  }));

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  // 이미 오늘 기록이 있는 트래킹 루틴은 기본으로 "기록됨" 표시만 보여주고, 이 Set에 들어있는
  // 동안만 입력창을 다시 펼친다 — "수정"을 눌러야 입력창이 나타나고 "저장"하면 다시 접혀서
  // 표시가 바뀌는 게 눈에 보여야, 저장이 실제로 됐는지 확인할 수 있다는 피드백을 반영
  const [editingTrackingIds, setEditingTrackingIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  // "리스트/타임라인" 탭을 두 번 연속 탭하면 그걸 오늘 탭 기본 화면으로 저장한다(2026-09-22) —
  // 앱을 껐다 켜도 저장된 쪽이 먼저 보이게 AsyncStorage에 저장
  const [defaultViewMode, setDefaultViewMode] = useState<'list' | 'timeline' | null>(null);
  // 어느 쪽이 기본인지 표시하는 작은 원(●) — 처음엔 기본값인 동안 항상 떠 있었는데,
  // "안 그래도 알고 있는데 계속 떠 있어서 거슬린다"는 피드백(2026-09-22)으로 변경:
  // 이제는 두 번 탭해서 "방금 기본값으로 저장했다"는 걸 알려주는 용도로만, 그 순간에
  // 잠깐(6초) 나타났다 사라진다. 앱 시작 시 저장된 기본값을 불러올 때는 안 뜬다
  // (기본값을 "설정할 때"만 뜨는 게 목적이라 불러오기는 대상이 아님)
  const [showDefaultDot, setShowDefaultDot] = useState<'list' | 'timeline' | null>(null);
  const defaultDotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listTapAtRef = useRef(0);
  const timelineTapAtRef = useRef(0);
  useEffect(() => {
    AsyncStorage.getItem(DEFAULT_VIEW_MODE_KEY).then((saved) => {
      if (saved === 'list' || saved === 'timeline') {
        setDefaultViewMode(saved);
        setViewMode(saved);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function handleViewModeTap(mode: 'list' | 'timeline') {
    const tapAtRef = mode === 'list' ? listTapAtRef : timelineTapAtRef;
    const now = Date.now();
    const isDoubleTap = now - tapAtRef.current < 300;
    tapAtRef.current = isDoubleTap ? 0 : now;
    setViewMode(mode);
    if (isDoubleTap) {
      setDefaultViewMode(mode);
      AsyncStorage.setItem(DEFAULT_VIEW_MODE_KEY, mode);
      hideViewModeHint();
      setShowDefaultDot(mode);
      if (defaultDotTimerRef.current) clearTimeout(defaultDotTimerRef.current);
      defaultDotTimerRef.current = setTimeout(() => setShowDefaultDot(null), 6000);
    }
  }
  // "두 번 탭하면 기본 화면으로 저장된다"는 걸 모르면 발견하기 어려운 기능이라, 최초 1회
  // 자동으로 안내를 보여준다 — 설정 화면 회원탈퇴 안내(deleteAccountTooltip)와 같은 디자인
  // (흰 배경+주색 테두리), "닫기"/"다시 보지 않음" 포함(2026-09-22)
  const [showViewModeHint, setShowViewModeHint] = useState(false);
  const [dontShowViewModeHintAgain, setDontShowViewModeHintAgain] = useState(false);
  // FAB 안내와 같은 이유(userId 의존성 추가, 2026-09-22)로 회원탈퇴 후 재가입해도 다시 뜨게 함
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    AsyncStorage.getItem(VIEW_MODE_HINT_DISMISSED_KEY).then((dismissed) => {
      if (!cancelled && dismissed !== 'true') setShowViewModeHint(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  function hideViewModeHint() {
    setShowViewModeHint(false);
  }
  async function closeViewModeHint() {
    hideViewModeHint();
    if (dontShowViewModeHintAgain) await AsyncStorage.setItem(VIEW_MODE_HINT_DISMISSED_KEY, 'true');
  }
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

  const handleSaveTracking = useCallback(
    (routine: Routine) => {
      const raw = trackingInputsRef.current[routine.id];
      const value = Number(raw);
      if (!raw || Number.isNaN(value)) {
        // 값이 있던 기록을 지우고 빈 채로 저장(엔터)하면, 그냥 무시하는 대신 "기록삭제"와
        // 똑같이 처리해서 기록이 없는 상태로 되돌아가게 한다(다시 체크/입력할 수 있도록)
        if (completionsRef.current[routine.id]) handleCancelTracking(routine);
        return;
      }
      const existing = completionsRef.current[routine.id] ?? null;
      saveTrackingMutation.mutate({ routineId: routine.id, existingId: existing?.id ?? null, value });
      // 저장 즉시 "기록됨" 표시로 접어서, 입력창이 사라지고 새 값이 보이는 걸로 저장됐다는 걸 확인할 수 있게 한다
      closeEditTracking(routine.id);
    },
    [closeEditTracking, handleCancelTracking]
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
    <View
      style={styles.container}
      onLayout={(e) => {
        // FAB를 화면 밖으로 못 나가게 막으려면 이 화면이 실제로 얼마나 큰지 알아야 한다
        fabContainerWidth.value = e.nativeEvent.layout.width;
        fabContainerHeight.value = e.nativeEvent.layout.height;
      }}>
      {/* 예전엔 영상/일기/모음집/내 루틴 4개 버튼이 여기 가로로 나열돼 있었는데(2026-09-22),
          FAB를 탭하면 펼쳐지는 "카테고리" 메뉴(showCategoryMenu)로 옮겨서 화면 위쪽을 더
          깔끔하게 정리했다 */}

      {/* 안내 배지가 뜨면 예전엔 아래 "말로 루틴하기" 배너를 밀어내렸는데(레이아웃 흐름에
          끼어듦), 그 배너 위를 덮는 방식으로 바꿨다(2026-09-22) — position:'relative'인
          이 래퍼를 기준으로 안내 배지를 절대위치로 얹어서, 배지가 뜨거나 사라져도 아래
          배너 위치가 안 흔들리고 그 자리 그대로 배지가 덮었다 걷혔다 한다 */}
      <View style={styles.viewModeTabsWrap}>
        <View style={styles.viewModeTabs}>
          <AnimatedPressable
            style={[styles.viewModeTab, viewMode === 'list' && styles.viewModeTabActive]}
            onPress={() => handleViewModeTap('list')}>
            {showDefaultDot === 'list' && (
              <View style={[styles.viewModeDefaultDot, viewMode === 'list' && styles.viewModeDefaultDotActive]} />
            )}
            <Text style={[styles.viewModeTabText, viewMode === 'list' && styles.viewModeTabTextActive]}>
              {t('today.list')}
            </Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.viewModeTab, viewMode === 'timeline' && styles.viewModeTabActive]}
            onPress={() => handleViewModeTap('timeline')}>
            {showDefaultDot === 'timeline' && (
              <View style={[styles.viewModeDefaultDot, viewMode === 'timeline' && styles.viewModeDefaultDotActive]} />
            )}
            <Text style={[styles.viewModeTabText, viewMode === 'timeline' && styles.viewModeTabTextActive]}>
              {t('today.timeline')}
            </Text>
          </AnimatedPressable>
        </View>

        {showViewModeHint && (
          <View style={styles.viewModeHintWrap}>
            {/* 한 문장씩 줄바꿈되던 게 길이감이 안 예뻐서, 항목마다 작은 점(•)을 붙인
                목록 형태로 바꿨다(2026-09-22) — 문구 자체(today.viewModeHintText)는
                \n으로 구분된 문자열 하나라 여기서 줄 단위로 나눠 렌더링한다.
                ⚠️ 문장 속에서 실제 화면의 "작은 점"을 가리키는 기호로 처음엔 "●"를 써서
                따로 작게+위로 올려 흉내 냈는데, 중첩 Text의 세로 위치를 css처럼 정확히
                맞추기가 안드로이드/iOS 양쪽에서 안정적이지 않았다 — 대신 애초에 본문
                글자와 같은 크기에서도 작고 세로 중심에 자연스럽게 놓이는 문자
                "·"(middle dot)로 바꿔서, 별도 스타일 없이 문제 자체를 없앴다 */}
            <View style={styles.viewModeHintList}>
              {t('today.viewModeHintText')
                .split('\n')
                .map((line, index) => (
                  <View key={index} style={styles.viewModeHintRow}>
                    <Text style={styles.viewModeHintBullet}>•</Text>
                    <Text style={styles.viewModeHintLine}>{line}</Text>
                  </View>
                ))}
            </View>
            <View style={styles.viewModeHintFooter}>
              <AnimatedPressable onPress={() => setDontShowViewModeHintAgain((v) => !v)} hitSlop={8}>
                <Text style={styles.viewModeHintCheckboxLabel}>
                  {dontShowViewModeHintAgain ? '☑' : '☐'} {t('today.dontShowAgain')}
                </Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.viewModeHintCloseButton} onPress={closeViewModeHint} hitSlop={8}>
                <Text style={styles.viewModeHintCloseText}>{t('today.close')}</Text>
              </AnimatedPressable>
            </View>
          </View>
        )}
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
          onPlayVideo={handlePlayVideo}
          onSkipToday={handleSkipToday}
          onCancelTracking={handleCancelTracking}
          editingTrackingIds={editingTrackingIds}
          trackingInputs={trackingInputs}
          onStartEditTracking={startEditTracking}
          onChangeTrackingInput={handleChangeTrackingInput}
          onSaveTracking={handleSaveTracking}
          onFocusTracking={handleFocusTracking}
          onBlurTracking={handleBlurTracking}
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

      {/* FAB를 길게 눌러 옮기고 두 번 탭하면 초기화된다는 안내 + "다시 보지 않음" 체크.
          설정 화면 회원탈퇴 안내(deleteAccountTooltip)와 같은 디자인으로 통일 — 배경은
          항상 불투명한 흰색으로 고정하고 테마 주색은 테두리·아이콘·글자·닫기 버튼에만 입혀서
          어떤 테마색을 고르든 대비가 안정적으로 확보된다(2026-09-21). 자동으로는 안 사라지고
          "닫기"를 누르거나 FAB를 실제로 드래그하기 전까진 계속 떠 있다가, "다시 보지 않음"을
          체크하고 닫아야만 그다음부터 완전히 안 뜬다(2026-09-22) */}
      {showFabHint && (
        <View style={styles.fabHintWrap} pointerEvents="box-none">
          <View style={styles.fabHintCard}>
            <View style={styles.fabHintHeaderRow}>
              <Ionicons name="move-outline" size={15} color={accent} style={styles.fabHintIcon} />
              {/* 리스트/타임라인 안내처럼 행마다 View로 감싸서 점(•)을 붙였더니, 이 카드는
                  가로폭이 내용에 맞춰 줄어드는(alignItems:'flex-end', 고정 left가 없음)
                  구조라 안쪽 flex:1 Text의 너비가 제대로 안 잡혀서 줄바꿈이 10번 넘게
                  되는 버그가 있었다(2026-09-22) — 리스트/타임라인 안내는 left/right로
                  폭이 고정돼 있어서 괜찮았지만 이 카드는 구조가 달라서 같은 방식이 안
                  맞았다. flexShrink는 안쪽 두 Text가 아니라 이 둘을 감싸는 열(column)
                  View 하나에만 줘서(각 Text는 그 열의 폭을 그대로 물려받음) 너비 문제
                  없이 두 줄 사이에 살짝 여백만 추가했다 */}
              <View style={styles.fabHintTextColumn}>
                <Text style={styles.fabHintText}>
                  • 탭하면 루틴 추가·말로 루틴 추가하기·카테고리 메뉴가 펼쳐져요
                </Text>
                <Text style={[styles.fabHintText, styles.fabHintTextSpaced]}>
                  • 길게 눌러서 원하는 위치로 옮기고, 두 번 탭하면 원래 위치로 돌아와요
                </Text>
              </View>
            </View>
            <View style={styles.fabHintDivider} />
            <View style={styles.fabHintFooter}>
              <AnimatedPressable onPress={() => setDontShowFabHintAgain((v) => !v)} hitSlop={8}>
                <Text style={styles.fabHintCheckboxLabel}>
                  {dontShowFabHintAgain ? '☑' : '☐'} {t('today.dontShowAgain')}
                </Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.fabHintCloseButton} onPress={closeFabHint} hitSlop={8}>
                <Text style={styles.fabHintCloseText}>{t('today.close')}</Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      )}

      {/* 예전엔 위성 버튼들을 항상 그려두고 opacity만 0→1로 애니메이션했는데, 안드로이드의
          elevation(그림자)이 View의 opacity 애니메이션과 같이 옅어지지 않고 먼저 다 보여서
          "그림자만 먼저 보이고 글자는 안 보인다"는 버그로 이어졌다(2026-09-22) — fabExpanded가
          true일 때만 이 블록 전체(배경 판+위성 3개)를 아예 그리도록 바꿔서, 반투명하게
          걸쳐 있는 중간 상태 자체를 없앴다. 위치로 떠오르는 효과는 그대로 있고, 확대(scale)
          효과만 fabExpandProgress로 애니메이션한다 */}
      {fabExpanded && (
        <>
          {/* 배경 전체에 투명한 판을 깔아서, 위성 버튼이 아닌 다른 곳을 눌러도 자연스럽게
              접히게 한다 */}
          <AnimatedPressable style={styles.fabBackdrop} onPress={collapseFab} />

          {/* "카테고리" 위성 버튼 — 제일 많이 쓸 거라 FAB에 가장 가깝게(먼저 닿는 자리)
              배치했다(2026-09-22). 영상/일기/모음집/내 루틴으로 가는 목록을 바텀시트로 연다 */}
          <Animated.View style={[styles.fabSatelliteWrap, fabCategorySatelliteStyle]}>
            <View style={styles.fabSatelliteLabel}>
              <Text style={styles.fabSatelliteLabelText} numberOfLines={1}>
                {t('today.category')}
              </Text>
            </View>
            <AnimatedPressable style={styles.fabSatelliteButton} onPress={handleCategoryPress}>
              <Ionicons name="grid-outline" size={20} color="#fff" />
            </AnimatedPressable>
          </Animated.View>

          {/* "말로 루틴 추가하기" 위성 버튼 — 아래쪽 llmBanner와 같은 목적지(/llm-input)로
              가는 지름길 */}
          <Animated.View style={[styles.fabSatelliteWrap, fabLlmInputSatelliteStyle]}>
            <View style={styles.fabSatelliteLabel}>
              <Text style={styles.fabSatelliteLabelText} numberOfLines={1}>
                {t('today.llmBanner')}
              </Text>
            </View>
            <AnimatedPressable style={styles.fabSatelliteButton} onPress={handleLlmInputPress}>
              <Ionicons name="sparkles-outline" size={20} color="#fff" />
            </AnimatedPressable>
          </Animated.View>

          {/* "루틴 추가" 위성 버튼 — 가장 멀리(맨 위) 배치 */}
          <Animated.View style={[styles.fabSatelliteWrap, fabRoutineSatelliteStyle]}>
            <View style={styles.fabSatelliteLabel}>
              <Text style={styles.fabSatelliteLabelText} numberOfLines={1}>
                {t('today.addRoutine')}
              </Text>
            </View>
            <AnimatedPressable style={styles.fabSatelliteButton} onPress={handleAddRoutinePress}>
              <Ionicons name="add" size={22} color="#fff" />
            </AnimatedPressable>
          </Animated.View>
        </>
      )}

      {/* 화면 위쪽에 따로 있던 영상/일기/모음집/내 루틴 4개 버튼과 "루틴 추가"를 이 FAB
          하나로 합침(2026-09-22) — 짧게 탭하면 위 두 위성 버튼이 펼쳐지고, 길게 누른 채
          끌면 원하는 자리로 이동(화면 밖으론 못 나감), 두 번 연속 탭하면 기본 위치로
          초기화된다. borderRadius+그림자를 같은 View에 같이 주면 안드로이드에서 그림자가
          안 보이는 문제가 있어서(ShadowCard와 동일한 이유) 그림자 전용 바깥 껍데기와
          색+아이콘 담당 안쪽 버튼을 분리한다 */}
      <GestureDetector gesture={fabGesture}>
        <Animated.View style={[styles.fabShadowWrap, fabAnimatedStyle]}>
          <View style={styles.fabButton}>
            <Animated.View style={fabMainIconStyle}>
              <Ionicons name="add" size={24} color="#fff" />
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* "카테고리" 위성 버튼을 누르면 뜨는 바텀시트 — 영상/일기/모음집/내 루틴 4개를
          2x2 타일로 보여준다(2026-09-22, 예전엔 화면 위쪽에 가로로 나열된 버튼이었음).
          animationType="slide"는 뒤로가기로 닫을 때 배경 어둡게 깔린 판까지 시트와 같이
          아래로 밀려나가면서 그 판 잔상이 순간 시커먼 그림자처럼 보이는 문제가 있었다
          (RN Modal의 slide는 배경+시트를 한 덩어리로 통째로 움직이기 때문) — 배경은 그대로
          두고 밝기만 옅어지는 fade로 바꿔서 해결(2026-09-22) */}
      <Modal
        visible={showCategoryMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCategoryMenu(false)}>
        <View style={styles.categoryMenuBackdropInner}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowCategoryMenu(false)} />
          <View style={styles.categoryMenuSheet}>
            <View style={styles.categoryMenuHeaderRow}>
              <Text style={styles.categoryMenuTitle}>{t('today.category')}</Text>
              <AnimatedPressable onPress={() => setShowCategoryMenu(false)} hitSlop={8}>
                <Text style={styles.categoryMenuCloseText}>{t('today.close')}</Text>
              </AnimatedPressable>
            </View>
            <View style={styles.categoryMenuGrid}>
              <AnimatedPressable style={styles.categoryMenuTile} onPress={() => goToCategory('/videos')}>
                <View style={styles.categoryMenuTileIcon}>
                  <Ionicons name="film-outline" size={22} color={accent} />
                </View>
                <Text style={styles.categoryMenuTileText}>{t('today.video')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.categoryMenuTile} onPress={goToTodayDiary}>
                <View style={styles.categoryMenuTileIcon}>
                  <Ionicons name="book-outline" size={22} color={accent} />
                </View>
                <Text style={styles.categoryMenuTileText}>{t('today.diary')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.categoryMenuTile} onPress={() => goToCategory('/presets')}>
                <View style={styles.categoryMenuTileIcon}>
                  <Ionicons name="albums-outline" size={22} color={accent} />
                </View>
                <Text style={styles.categoryMenuTileText}>{t('today.presets')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.categoryMenuTile} onPress={() => goToCategory('/my-routines')}>
                <View style={styles.categoryMenuTileIcon}>
                  <Ionicons name="list-outline" size={22} color={accent} />
                </View>
                <Text style={styles.categoryMenuTileText}>{t('today.myRoutines')}</Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
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
  fabShadowWrap: {
    position: 'absolute',
    right: 16,
    // summaryBar(하단 완료율 표시줄) 바로 위, 리스트/타임라인이 스크롤되는 영역과 겹치는
    // 자리에 뜨도록 여유를 더 둔다 — 너무 아래(화면 맨 밑)에 두면 summaryBar 옆에 나란히
    // 붙어 보여서 "루틴 목록과 별개"인 것처럼 보였다
    bottom: 76,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    zIndex: 20,
  },
  fabButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // FAB를 탭해서 펼쳤을 때 배경 전체를 덮는 투명 판 — 다른 곳을 누르면 접히게 한다.
  // fabButton(zIndex 20)이나 위성 버튼(zIndex 21)보다는 아래, 나머지 화면 내용보다는
  // 위에 있어야 해서 그 사이 값을 준다
  fabBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 19,
  },
  // 위성 버튼(루틴 추가/카테고리) 한 쌍을 감싸는 자리 — FAB와 같은 오른쪽 아래 기준점에서
  // 시작해 애니메이션(fabRoutineSatelliteStyle/fabCategorySatelliteStyle)으로 떠오른다.
  // 라벨(글자)이 왼쪽, 동그란 버튼이 오른쪽에 오도록 가로 배치
  fabSatelliteWrap: {
    position: 'absolute',
    right: 16,
    bottom: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 21,
  },
  fabSatelliteLabel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  fabSatelliteLabelText: {
    color: accent,
    fontSize: 12,
    fontWeight: '700',
  },
  fabSatelliteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  // "카테고리" 위성 버튼을 눌렀을 때 뜨는 바텀시트(영상/일기/모음집/내 루틴 4개)
  categoryMenuBackdropInner: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  categoryMenuSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  categoryMenuHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  categoryMenuTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  categoryMenuCloseText: {
    color: accent,
    fontSize: 14,
  },
  categoryMenuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryMenuTile: {
    width: '47%',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: `${accent}33`,
  },
  categoryMenuTileIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${accent}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryMenuTileText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // FAB 위에 떠서 "옮길 수 있다"고 알려주는 말풍선.
  // ⚠️ 진짜 원인을 여기서 찾았다(2026-09-21): 이 파일의 View는 '@/components/Themed'의
  // View라 style에 backgroundColor를 안 주면 항상 테마 배경색(라이트 모드면 흰색)이
  // 기본으로 깔린다 — 체크박스/닫기가 들어있던 fabHintFooter(View)에 backgroundColor를
  // 안 줬더니 그 자리만 흰 배경이 깔리고, 그 위 흰 글씨(color:'#fff')가 흰 배경과 겹쳐
  // 안 보이면서 "안내문 아래 정체불명의 블록"처럼 보였던 것 — 여기 쓰는 View는 전부
  // backgroundColor: 'transparent'를 명시해서 안쪽 어두운 카드 색이 그대로 비치게 한다
  fabHintWrap: {
    position: 'absolute',
    backgroundColor: 'transparent',
    right: FAB_DEFAULT_RIGHT,
    bottom: FAB_DEFAULT_BOTTOM + FAB_SIZE + 10,
    maxWidth: 240,
    // alignItems가 기본값(stretch)이면 폭이 정해지지 않은(오른쪽만 고정) 이 컨테이너가
    // maxWidth(240)까지 억지로 늘어나 카드가 필요 이상으로 넓적/길쭉해 보일 수 있다 —
    // 내용 크기만큼만 오른쪽 정렬로 자연스럽게 줄어들게 한다
    alignItems: 'flex-end',
    zIndex: 25,
  },
  fabHintCard: {
    // 설정 화면 deleteAccountTooltip과 같은 패턴 — 배경을 불투명한 흰색으로 고정해서
    // 뒤에 깔린 다른 글자가 안 비치게 하고, 테마 주색 테두리로만 포인트를 준다
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 6,
  },
  fabHintHeaderRow: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fabHintIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  fabHintTextColumn: {
    flexShrink: 1,
  },
  fabHintText: {
    color: accent,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  fabHintTextSpaced: {
    marginTop: 6,
  },
  fabHintDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: `${accent}33`,
    marginTop: 10,
    marginBottom: 8,
  },
  fabHintFooter: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fabHintCheckboxLabel: {
    color: accent,
    fontSize: 12,
    opacity: 0.75,
  },
  fabHintCloseButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  fabHintCloseText: {
    color: accent,
    fontSize: 12,
    fontWeight: '700',
  },
  // 안내 배지를 이 안에서 절대위치로 띄우기 위한 기준점(position:'relative') — 배지가
  // 뜨고 사라져도 이 래퍼의 높이는 안 바뀌어서 아래(말로 루틴하기 배너)가 안 밀린다
  viewModeTabsWrap: {
    position: 'relative',
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
  // 두 번 탭해서 기본 화면으로 고른 쪽에 작은 원으로 표시(2026-09-22) — 버튼 레이아웃(가운데
  // 정렬)에 영향 안 주도록 절대위치로 왼쪽에 살짝 얹는다
  viewModeDefaultDot: {
    position: 'absolute',
    top: 5,
    left: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: accent,
  },
  // 선택된(배경이 주색으로 꽉 찬) 탭 위에서는 원이 배경에 묻혀 안 보이니 흰색으로 바꾼다
  viewModeDefaultDotActive: {
    backgroundColor: '#fff',
  },
  // "두 번 탭하면 기본 화면 저장" 안내 — FAB 안내(fabHint)와 같은 흰 배경+주색 테두리
  // 디자인으로 통일. 예전엔 리스트/타임라인 박스 바로 아래에 흐름대로 배치해서 뜰 때마다
  // 아래 "말로 루틴하기" 배너를 밀어냈는데, 절대위치로 바꿔서 그 배너 위를 덮게
  // 했다(2026-09-22) — viewModeTabsWrap 바로 아래(탭 높이만큼) 위치에서 시작
  viewModeHintWrap: {
    position: 'absolute',
    top: 52,
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 6,
  },
  // 안내 항목을 점(•) 목록으로 표시(2026-09-22) — 문장을 한 줄로 이어붙이면 줄바꿈되는
  // 위치가 매번 달라져서 지저분해 보였는데, 항목별로 나눠서 각자 한 덩어리로 보이게 함
  viewModeHintList: {
    gap: 6,
  },
  viewModeHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  viewModeHintBullet: {
    color: accent,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  viewModeHintLine: {
    flex: 1,
    color: accent,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  viewModeHintFooter: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  viewModeHintCheckboxLabel: {
    color: accent,
    fontSize: 11,
    opacity: 0.75,
  },
  // FAB 안내의 "닫기" 버튼(fabHintCloseButton/Text)과 크기가 서로 달랐다는 피드백(2026-09-22)
  // — 두 안내가 같은 디자인 계열이니 크기도 통일
  viewModeHintCloseButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  viewModeHintCloseText: {
    color: accent,
    fontSize: 12,
    fontWeight: '700',
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
  // 단위 글자가 입력칸 뒤(오른쪽)에 있는 이상, 그 폭만큼은 입력칸이 체크박스 위치보다
  // 왼쪽에 있을 수밖에 없다(단위가 차지하는 자리 자체가 체크형엔 없는 요소라서) — 단위를
  // 최대 2글자+"..."로 짧게, 글씨도 작게(styles.unit) 줄이고 여백도 최소로 당겨서 이 밀림을
  // 물리적으로 가능한 만큼 최대한 좁혔다(2026-09-21)
  trackingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 3,
    flexShrink: 0,
    // 체크형(marginRight 10)보다 더 당겨서 입력칸을 최대한 오른쪽으로 붙인다
    marginRight: 1,
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
  // 단위 글자 수가 루틴마다 달라서 이 폭이 그때그때 바뀌면 옆의 다른 줄과 위치가 안 맞아
  // 보인다(2026-09-21) — 단위는 최대 2글자+"..."로 길이를 제한하고 글씨도 작게 줄여서,
  // 항상 같은 좁은 폭만 차지하도록 고정한다(체크박스 위치에서 밀리는 정도를 최소화하기 위함)
  unit: {
    width: 32,
    fontSize: 11,
    opacity: 0.7,
    includeFontPadding: false,
  },
  // 체크박스/완료 뱃지가 항상 같은 가로 위치에서 중심을 잡도록 고정폭 슬롯으로 감쌈
  // (버튼 내용이 이 폭보다 작아야 눌려서 깨지지 않음 — "저장" 버튼 기준 여유있게 56)
  actionSlot: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    // 오른쪽 아래 "루틴 추가" 뱃지와 살짝 겹쳐 보인다는 피드백으로 체크/트래킹 쪽을
    // 왼쪽으로 10px만 살짝 당김
    marginRight: 10,
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
    backgroundColor: withAlpha(accent, 0.3),
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
