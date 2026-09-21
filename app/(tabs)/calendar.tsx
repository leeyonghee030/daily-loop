import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, ScrollView, StyleSheet, TextInput, TouchableWithoutFeedback } from 'react-native';
import { CalendarList, type DateData } from 'react-native-calendars';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  border,
  cardRadius,
  fontDisplay,
  fontMono,
  statusDone,
  statusMissed,
  statusPartial,
  textMuted,
  withAlpha,
} from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useTranslation, type TranslationKey } from '@/lib/language';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import {
  createMemo,
  deleteMemo,
  fetchMemosInRange,
  updateMemo,
  MEMO_COLORS,
  MEMO_COLOR_ORDER,
  type DateMemo,
  type MemoColor,
} from '@/lib/date-memos';
import { fetchDiaryDatesInRange } from '@/lib/diary';
import { fetchPhotoDiaryDatesInRange } from '@/lib/photo-diary';
import { syncSlotAlarms } from '@/lib/notifications';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
import {
  computeDayStatus,
  fetchStats,
  formatLocalDate,
  routinesForDate,
  fetchAllRoutinesForCalendar,
  fetchMonthData,
  fetchWeekData,
  toggleCheckCompletion,
  saveTrackingValue,
  SLOT_LABEL_KEYS,
  type DayStatus,
  type MonthData,
  type RoutineCompletion,
} from '@/lib/routines';

const STATUS_COLORS: Record<DayStatus, string> = {
  done: statusDone,
  partial: statusPartial,
  missed_required: statusMissed,
};

const WEEKDAY_KEYS = [
  'calendar.weekdaySun',
  'calendar.weekdayMon',
  'calendar.weekdayTue',
  'calendar.weekdayWed',
  'calendar.weekdayThu',
  'calendar.weekdayFri',
  'calendar.weekdaySat',
] as const;
const WEEK_COLUMN_WIDTH = 86; // weekColumn 스타일의 width(80) + marginRight(6)

function timeLabel(routine: MonthData['routines'][number], t: (key: TranslationKey) => string): string {
  if (routine.is_instant && routine.scheduled_time_start) {
    return routine.scheduled_time_start.slice(0, 5);
  }
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return t(SLOT_LABEL_KEYS[routine.slots.slot_type]);
  return '';
}

// 주는 항상 일요일부터 토요일까지 — 오늘이 화면에 안 보이는 문제는 주 범위가 아니라
// 가로 스크롤 위치로 해결한다(scrollWeekToToday)
function sundayOf(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function groupMemosByDate(list: DateMemo[]): Record<string, DateMemo[]> {
  const map: Record<string, DateMemo[]> = {};
  for (const memo of list) {
    if (!map[memo.memo_date]) map[memo.memo_date] = [];
    map[memo.memo_date].push(memo);
  }
  return map;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

// 월간뷰는 CalendarList가 스와이프 대비로 여러 달을 미리 그려두는데, 정작 공휴일/메모/일기/완료상태는
// "지금 보고 있는 딱 1개 달"만 불러오고 있어서, 스와이프로 옆 달(이미 한 번 봤던 달이어도)로 넘어가는
// 순간 화면은 이미 넘어갔는데 상태 갱신이 살짝 늦게 따라오는 찰나에 표시가 비었다가 다시 채워지는
// 버그가 있었음(2026-09-17 발견). 아래 3개 merge 함수는 "지금 막 불러온 달의 날짜 범위"만 최신값으로
// 덮어쓰고, 그 범위 밖(이전에 봤던 다른 달)의 누적값은 그대로 보존해서 한 번 본 달은 계속 채워진
// 상태로 남아있게 한다
function mergeRangeRecord<T>(
  prev: Record<string, T>,
  incoming: Record<string, T>,
  rangeStart: string,
  rangeEnd: string
): Record<string, T> {
  const kept: Record<string, T> = {};
  for (const key in prev) {
    if (key < rangeStart || key > rangeEnd) kept[key] = prev[key];
  }
  return { ...kept, ...incoming };
}

function mergeRangeNestedRecord<T>(
  prev: Record<string, Record<string, T>>,
  incoming: Record<string, Record<string, T>>,
  rangeStart: string,
  rangeEnd: string
): Record<string, Record<string, T>> {
  const routineIds = new Set([...Object.keys(prev), ...Object.keys(incoming)]);
  const next: Record<string, Record<string, T>> = {};
  for (const id of routineIds) {
    const merged: Record<string, T> = {};
    const oldMap = prev[id] ?? {};
    for (const date in oldMap) {
      if (date < rangeStart || date > rangeEnd) merged[date] = oldMap[date];
    }
    Object.assign(merged, incoming[id] ?? {});
    if (Object.keys(merged).length > 0) next[id] = merged;
  }
  return next;
}

function mergeRangeSet(prev: Set<string>, incoming: string[], rangeStart: string, rangeEnd: string): Set<string> {
  const next = new Set<string>();
  for (const d of prev) {
    if (d < rangeStart || d > rangeEnd) next.add(d);
  }
  for (const d of incoming) next.add(d);
  return next;
}

// 날짜 칸(dayCell) 높이가 고정값이라, 8월처럼 6줄이 필요한 달은 5줄짜리 달보다 총 높이가
// 한 줄만큼 더 필요해서 캘린더 박스(MONTH_CALENDAR_HEIGHT 고정)를 넘어 마지막 줄이 잘려
// 안 보이는 버그가 있었다(2026-09-21) — 그 달이 실제로 몇 줄(4~6)인지 계산해서, 6줄인
// 달만 줄 높이를 살짝 줄여 항상 같은 박스 안에 다 들어가게 한다
function weeksInMonth(year: number, month1to12: number): number {
  const firstWeekday = new Date(year, month1to12 - 1, 1).getDay();
  const daysInMonth = new Date(year, month1to12, 0).getDate();
  return Math.ceil((firstWeekday + daysInMonth) / 7);
}

// 트래킹 단위가 길면 옆의 입력칸/제목 자리를 밀어내는 문제가 있어서(오늘 탭과 동일한 이유),
// 여기서도 2글자까지만 보여주고 그 뒤는 "..."으로 자른다(2026-09-21)
function truncateTrackingUnit(unit?: string | null): string {
  if (!unit) return '';
  return unit.length > 2 ? `${unit.slice(0, 2)}...` : unit;
}

type DayCellProps = {
  dateStr: string;
  day: number;
  isDisabled: boolean;
  status: DayStatus | null;
  isSelected: boolean;
  isToday: boolean;
  isHoliday: boolean;
  hasPhotoDiary: boolean;
  hasDiary: boolean;
  memoColors: MemoColor[];
  accent: string;
  theme: 'light' | 'dark';
  styles: ReturnType<typeof createStyles>;
  cellHeight: number;
  onSelect: (date: string) => void;
};

// 이 아래 값(전부 원시값/원시값 배열)만 실제로 안 바뀌었으면 다시 안 그린다. 오늘 탭 체크박스
// 하나 누를 때 월간뷰 전체(최대 24/12개월치 미리 그려둔 날짜 칸)가 통째로 다시 그려지며
// 렉이 걸리던 원인 — renderDay는 monthAccum(완료기록 전체)이 바뀔 때마다 새로 만들어지고,
// 이게 CalendarList에 전달되면 미리 그려둔 날짜 칸 전부가 memo 비교에서 걸려 다시 그려졌는데,
// 실제로 화면이 달라지는 건 방금 체크한 "그 하루"뿐이었다. renderDay 자체는 계속 새로 만들어지되
// (monthAccum이 진짜로 바뀌었으니 어쩔 수 없음), 그 안에서 각 날짜마다 필요한 값만 뽑아
// DayCell(React.memo)에 넘기면, 값이 그대로인 나머지 날짜 칸들은 React가 실제 렌더를 건너뛴다
function dayCellPropsEqual(prev: DayCellProps, next: DayCellProps): boolean {
  return (
    prev.dateStr === next.dateStr &&
    prev.day === next.day &&
    prev.isDisabled === next.isDisabled &&
    prev.status === next.status &&
    prev.isSelected === next.isSelected &&
    prev.isToday === next.isToday &&
    prev.isHoliday === next.isHoliday &&
    prev.hasPhotoDiary === next.hasPhotoDiary &&
    prev.hasDiary === next.hasDiary &&
    prev.accent === next.accent &&
    prev.theme === next.theme &&
    prev.styles === next.styles &&
    prev.cellHeight === next.cellHeight &&
    prev.onSelect === next.onSelect &&
    prev.memoColors.length === next.memoColors.length &&
    prev.memoColors.every((c, i) => c === next.memoColors[i])
  );
}

const DayCell = memo(function DayCell({
  dateStr,
  day,
  isDisabled,
  status,
  isSelected,
  isToday,
  isHoliday,
  hasPhotoDiary,
  hasDiary,
  memoColors,
  accent,
  theme,
  styles,
  cellHeight,
  onSelect,
}: DayCellProps) {
  return (
    <AnimatedPressable onPress={() => onSelect(dateStr)} style={[styles.dayCell, { minHeight: cellHeight }]}>
      <View style={styles.diaryIconSlot}>
        {hasPhotoDiary ? (
          <Ionicons name="camera-outline" size={10} color={textMuted} />
        ) : (
          hasDiary && <Ionicons name="book-outline" size={10} color={textMuted} />
        )}
      </View>
      <View
        style={[
          styles.dayNumberWrap,
          status ? { backgroundColor: withAlpha(STATUS_COLORS[status], 0.35) } : null,
          (isSelected || isToday) && { borderWidth: 2, borderColor: accent },
        ]}>
        <Text
          style={[
            styles.dayNumberText,
            { color: isDisabled ? (theme === 'dark' ? '#555' : '#ccc') : isHoliday ? accent : Colors[theme].text },
            // 공휴일도 오늘처럼 굵게 — 테마색을 "검정"(#4A4A4A, 거의 검정)으로 골랐을 때도
            // 색만으로는 구분이 잘 안 될 수 있어서, 굵기 차이로 항상 표시가 나게 한다
            (isToday || isHoliday) ? { fontWeight: '700' } : null,
          ]}>
          {day}
        </Text>
        {/* 색만으로는 테마색을 "검정"에 가까운 프리셋으로 골랐을 때 티가 잘 안 나서, 색과
            무관하게 항상 눈에 띄는 작은 점을 숫자 아래에 덧붙인다 */}
        {isHoliday && <View style={[styles.holidayDot, { backgroundColor: accent }]} />}
      </View>
      {memoColors.length > 0 && (
        <View style={styles.memoStack}>
          {memoColors.map((color, index) => (
            <View
              key={index}
              style={[styles.memoBar, { backgroundColor: MEMO_COLORS[color].bg, borderColor: MEMO_COLORS[color].border }]}
            />
          ))}
        </View>
      )}
    </AnimatedPressable>
  );
},
dayCellPropsEqual);

type MonthCalendarSectionProps = {
  height: number;
  screenWidth: number;
  calendarCursor: string;
  calendarTheme: object;
  onMonthChange: (date: DateData) => void;
  monthAccum: MonthData;
  monthMemosAccum: Record<string, DateMemo[]>;
  monthDiaryAccum: Set<string>;
  monthPhotoDiaryAccum: Set<string>;
  selectedDate: string | null;
  theme: 'light' | 'dark';
  todayStr: string;
  accent: string;
  styles: ReturnType<typeof createStyles>;
  onSelectDate: (date: string) => void;
};

// 월간뷰(CalendarList)를 별도 컴포넌트로 분리하고 React.memo로 감쌌다. CalendarScreen은
// 트래킹 입력창 타이핑, 메모 입력, 모달 열고 닫기 같은 상태도 전부 한 컴포넌트 안에 같이
// 들고 있어서, 분리하기 전엔 이런 것과 무관한 상태가 바뀔 때마다도(예: 트래킹 숫자
// 한 글자 입력) CalendarList까지 매번 다시 그려지고 있었다 — CalendarList 자체가
// React.memo로 감싸여 있지 않은 라이브러리 컴포넌트라, 부모(CalendarScreen)가 리렌더되면
// props가 그대로여도 무조건 다시 실행됐기 때문. 이 값들(monthAccum 등)이 실제로 바뀔 때만
// 다시 그려지도록 여기서 한 번 막아준다(2026-09-21)
const MonthCalendarSection = memo(function MonthCalendarSection({
  height,
  screenWidth,
  calendarCursor,
  calendarTheme,
  onMonthChange,
  monthAccum,
  monthMemosAccum,
  monthDiaryAccum,
  monthPhotoDiaryAccum,
  selectedDate,
  theme,
  todayStr,
  accent,
  styles,
  onSelectDate,
}: MonthCalendarSectionProps) {
  const renderDay = useCallback(
    ({ date, state }: { date?: DateData; state?: string }) => {
      if (!date) return <View />;
      const dateStr = date.dateString;
      const status = dateStr <= todayStr ? computeDayStatus(dateStr, monthAccum) : null;
      const memoColors = (monthMemosAccum[dateStr] ?? []).slice(0, 5).map((memo) => memo.color);
      const isDisabled = state === 'disabled';
      // 공휴일이면 날짜 숫자를 주색으로 — 흐리게 처리되는 이전/다음 달 날짜는 예외
      const isHoliday = !isDisabled && !!monthAccum.holidayDates[dateStr];
      // 기본 줄 높이(46)는 5줄짜리 달 기준으로 맞춰져 있어서, 6줄이 필요한 달(예: 8월)은
      // 그대로 두면 총 높이가 MONTH_CALENDAR_HEIGHT를 넘어 마지막 줄이 잘려 보인다 —
      // 6줄인 달만 그 비율만큼 줄 높이를 줄여서 항상 같은 박스 안에 다 들어가게 한다
      const rows = weeksInMonth(date.year, date.month);
      // react-native-calendars가 주(week) 행 사이에 라이브러리 자체 여백을 더 두기 때문에
      // 단순 비례 계산(46*5/6≈38)보다 조금 더 줄여야 실제로 다 들어간다(2026-09-21)
      const cellHeight = rows > 5 ? 34 : 46;

      return (
        <DayCell
          dateStr={dateStr}
          day={date.day}
          isDisabled={isDisabled}
          status={status}
          isSelected={selectedDate === dateStr}
          isToday={dateStr === todayStr}
          isHoliday={isHoliday}
          hasPhotoDiary={monthPhotoDiaryAccum.has(dateStr)}
          hasDiary={monthDiaryAccum.has(dateStr)}
          cellHeight={cellHeight}
          memoColors={memoColors}
          accent={accent}
          theme={theme}
          styles={styles}
          onSelect={onSelectDate}
        />
      );
    },
    [monthAccum, monthMemosAccum, monthDiaryAccum, monthPhotoDiaryAccum, selectedDate, theme, todayStr, accent, styles, onSelectDate]
  );

  return (
    // 높이를 고정해서(height=MONTH_CALENDAR_HEIGHT) 달마다 셀 내용이 늦게 채워져도 이 박스
    // 자체는 안 움직이게 한다. marginTop은 스트릭 카드를 숨긴 뒤 캘린더가 화면 위쪽에 너무
    // 붙어 보인다는 요청으로 살짝 내린 값(2026-09-21)
    <View style={{ height, marginTop: 10 }}>
      <CalendarList
        horizontal
        pagingEnabled
        // 기본값(과거/미래 각 50개월, 총 101개월치)이 커스텀 dayComponent까지 겹쳐서 최초
        // 진입 시 로딩이 유독 오래 걸리는 원인이었음 — 실제로 쓸 일 있는 범위로 줄임
        pastScrollRange={24}
        futureScrollRange={12}
        calendarWidth={screenWidth}
        current={calendarCursor}
        onMonthChange={onMonthChange}
        dayComponent={renderDay}
        theme={calendarTheme}
      />
    </View>
  );
});

export default function CalendarScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const theme = useColorScheme() ?? 'light';
  const router = useRouter();
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  const today = new Date();
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  // CalendarList의 current prop 전용 — year/month(스와이프하면 계속 바뀜)와 일부러 분리했다.
  // current를 year/month에 그대로 묶으면, 라이브러리가 current prop이 바뀔 때마다
  // "그 달로 다시 스크롤"을 실행해서(내부 useEffect) 사용자가 직접 스와이프하는 것과
  // 서로 되먹임을 일으켜 빠르게 몇 달을 넘기면 화면이 혼자 이 달 저 달로 튀는 버그가 있었음.
  // 이제 current는 "명시적으로 이 달로 점프하고 싶을 때"(최초 진입, "월" 탭 클릭)만 바꾼다
  const [calendarCursor, setCalendarCursor] = useState(
    () => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  );
  const [weekStart, setWeekStart] = useState(() => formatLocalDate(sundayOf(today)));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [memoText, setMemoText] = useState('');
  const [memoColor, setMemoColor] = useState<MemoColor>('yellow');
  // 날짜 상세 시트에서 트래킹형 루틴을 탭하면 숫자 입력창으로 바뀌는데, 그 입력창 상태
  const [editingTrackingRoutineId, setEditingTrackingRoutineId] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState('');
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = formatLocalDate(new Date(year, month, 0));
  const weekEnd = addDaysToDateStr(weekStart, 6);

  useEffect(() => {
    setMemoText('');
    setMemoColor('yellow');
    setEditingMemoId(null);
  }, [selectedDate]);

  // 역대 최고 스트릭 배지용 — 오늘/통계 탭과 정확히 같은 쿼리 키(['stats', userId])를 써서
  // 캐시를 공유한다. 예전엔 이 화면만 따로 fetchStats를 불러서, 다른 탭에서 체크해도 이 배지가
  // 안 바뀌다가 앱을 껐다 켜야만 갱신되는 버그가 있었음 — 이제는 어느 탭에서 체크하든 셋 중
  // 하나가 다시 불러오면 나머지도 같은 캐시를 보고 있어 자연스럽게 같이 갱신된다
  const statsQuery = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => fetchStats(userId!),
    enabled: !!userId,
  });
  const bestStreakEver = statsQuery.data?.bestStreakEver ?? null;

  // 월/주 각각의 루틴+완료기록. react-query가 알아서 "최신 요청만 반영"하고 이전 화면을
  // 그대로 둔 채 조용히 최신화해주므로, 예전에 손으로 만들던 요청 순번 가드/로딩 스피너
  // 억제 로직이 필요 없어졌다 — key(연/월 또는 주 시작일)가 바뀌면 자동으로 다시 불러온다
  // enabled에 viewMode 조건을 넣어서, 지금 화면에 안 보이는 뷰(월/주)는 백그라운드에서
  // 계속 요청하지 않게 한다 — 이게 빠져 있으면 항상 월+주 데이터를 둘 다 불러오게 되어
  // 예전(둘 중 활성화된 뷰만 load)보다 네트워크 요청이 오히려 늘어나는 회귀가 생김
  // 달이 바뀌어도 루틴 목록 자체는 거의 그대로라, 여기서 한 번만 받아 month/week 쿼리가
  // 재사용한다 — 예전엔 달을 넘길 때마다 이 목록까지 매번 새로 받아와서(서버 왕복 2회 직렬 대기)
  // 새 달로 이동할 때 체감 로딩이 2초 가까이 걸렸음(2026-09-17)
  const calendarRoutinesQuery = useQuery({
    queryKey: ['calendar-routines', userId],
    queryFn: () => fetchAllRoutinesForCalendar(userId!),
    enabled: !!userId,
  });
  const monthQuery = useQuery({
    queryKey: ['month-data', userId, year, month],
    queryFn: () => fetchMonthData(userId!, year, month, calendarRoutinesQuery.data),
    enabled: !!userId && viewMode === 'month',
  });
  const weekQuery = useQuery({
    queryKey: ['week-data', userId, weekStart],
    queryFn: () => fetchWeekData(userId!, weekStart, calendarRoutinesQuery.data),
    enabled: !!userId && viewMode === 'week',
  });
  // 메모/일기 표시는 부가 정보 — 월/주 각각 자기 범위만큼만 따로 쿼리한다(예전엔 전역
  // Map/Set에 "새로 불러온 범위만 교체"하는 방식으로 손으로 병합했었는데, 이제 범위별로
  // 쿼리 키가 다르니 react-query가 알아서 캐시를 나눠서 관리해준다)
  const monthMemosQuery = useQuery({
    queryKey: ['memos', userId, monthStart, monthEnd],
    queryFn: () => fetchMemosInRange(userId!, monthStart, monthEnd),
    enabled: !!userId && viewMode === 'month',
  });
  const monthDiaryQuery = useQuery({
    queryKey: ['diary-dates', userId, monthStart, monthEnd],
    queryFn: () => fetchDiaryDatesInRange(userId!, monthStart, monthEnd),
    enabled: !!userId && viewMode === 'month',
  });
  const weekMemosQuery = useQuery({
    queryKey: ['memos', userId, weekStart, weekEnd],
    queryFn: () => fetchMemosInRange(userId!, weekStart, weekEnd),
    enabled: !!userId && viewMode === 'week',
  });
  // 메모 추가/수정/삭제는 지금 보고 있는 뷰(월 또는 주)의 메모 쿼리 캐시를 직접 갱신한다
  const activeMemoQueryKey =
    viewMode === 'week' ? ['memos', userId, weekStart, weekEnd] : ['memos', userId, monthStart, monthEnd];

  const weekDiaryQuery = useQuery({
    queryKey: ['diary-dates', userId, weekStart, weekEnd],
    queryFn: () => fetchDiaryDatesInRange(userId!, weekStart, weekEnd),
    enabled: !!userId && viewMode === 'week',
  });

  // 사진일기 작성 날짜도 같은 방식으로 조회 — 둘 다 있는 날은 카메라 아이콘을 우선 표시
  const monthPhotoDiaryQuery = useQuery({
    queryKey: ['photo-diary-dates', userId, monthStart, monthEnd],
    queryFn: () => fetchPhotoDiaryDatesInRange(userId!, monthStart, monthEnd),
    enabled: !!userId && viewMode === 'month',
  });
  const weekPhotoDiaryQuery = useQuery({
    queryKey: ['photo-diary-dates', userId, weekStart, weekEnd],
    queryFn: () => fetchPhotoDiaryDatesInRange(userId!, weekStart, weekEnd),
    enabled: !!userId && viewMode === 'week',
  });

  const weekMemosByDate = useMemo(() => groupMemosByDate(weekMemosQuery.data ?? []), [weekMemosQuery.data]);
  const weekDiaryDates = useMemo(() => new Set(weekDiaryQuery.data ?? []), [weekDiaryQuery.data]);
  const weekPhotoDiaryDates = useMemo(() => new Set(weekPhotoDiaryQuery.data ?? []), [weekPhotoDiaryQuery.data]);

  // 월간뷰 전용 누적 캐시 — 스와이프로 지나간 달의 데이터도 계속 들고 있어서 다시 그 달을
  // 지나갈 때 비어 보이지 않게 한다(위 mergeRange* 함수 설명 참고).
  // useEffect로 한 박자 늦게 합치면(=데이터 도착 렌더 → effect → 또 한 번의 렌더) 그 사이에
  // CalendarList가 미리 그려둔 최대 24개월치 날짜 칸이 매번 두 번씩 다시 그려져서 오히려
  // 채워지는 속도가 느려짐 — useMemo 안에서 ref를 직접 갱신해 데이터가 도착한 바로 그 렌더에서
  // 한 번에 반영되게 한다
  const monthAccumRef = useRef<MonthData>({
    routines: [],
    completionsByRoutine: {},
    skipDatesByRoutine: {},
    holidayDates: {},
  });
  const monthAccum = useMemo(() => {
    const data = monthQuery.data;
    if (data) {
      monthAccumRef.current = {
        routines: data.routines,
        completionsByRoutine: mergeRangeNestedRecord(monthAccumRef.current.completionsByRoutine, data.completionsByRoutine, monthStart, monthEnd),
        skipDatesByRoutine: mergeRangeNestedRecord(monthAccumRef.current.skipDatesByRoutine, data.skipDatesByRoutine, monthStart, monthEnd),
        holidayDates: mergeRangeRecord(monthAccumRef.current.holidayDates, data.holidayDates, monthStart, monthEnd),
      };
    }
    return monthAccumRef.current;
  }, [monthQuery.data, monthStart, monthEnd]);

  // 체크/트래킹을 누르면 모달의 체크표시는 monthAccum이 바뀌자마자 그 즉시(높은 우선순위로)
  // 반영돼야 답답하지 않은데, 월간뷰 그리드(MonthCalendarSection)는 3개월치를 다시 계산해야 해서
  // 그것까지 같은 렌더에서 같이 끝내려고 하면 전체 커밋이 그리드 속도에 발목 잡혀 체크 반응까지
  // 같이 느려 보였다(2026-09-21) — 모달 쪽(detail/activeData)은 즉시 값(monthAccum)을 그대로
  // 쓰고, 그리드에만 넘기는 값은 useDeferredValue로 낮은 우선순위로 미뤄서, 체크 반응은 즉시
  // 보이고 그리드는 한 박자 뒤에 조용히 따라오게 분리한다(korean-font.tsx의 useDeferredValue와 동일한 패턴)
  const deferredMonthAccum = useDeferredValue(monthAccum);

  // selectedDate도 같은 이유로 따로 미룬다 — 날짜 상세 팝업을 "닫기"로 닫는 것도
  // selectedDate를 null로 바꾸는 상태 변화라, 그리드에 그대로 넘기면 "선택 테두리를 지우려면
  // 3개월치 그리드를 다시 그려야 함"이 모달을 닫는 동작(Modal의 visible=false)까지 같이
  // 붙잡고 있어서 닫기 버튼이 늦게 반응하는 것처럼 보였다(2026-09-21) — 모달의 visible/detail은
  // 즉시 값을 쓰고, 그리드의 "선택된 날짜 테두리" 표시만 지연 허용한다
  const deferredSelectedDate = useDeferredValue(selectedDate);

  const monthMemosAccumRef = useRef<Record<string, DateMemo[]>>({});
  const monthMemosAccum = useMemo(() => {
    const data = monthMemosQuery.data;
    if (data) {
      const kept: Record<string, DateMemo[]> = {};
      for (const date in monthMemosAccumRef.current) {
        if (date < monthStart || date > monthEnd) kept[date] = monthMemosAccumRef.current[date];
      }
      monthMemosAccumRef.current = { ...kept, ...groupMemosByDate(data) };
    }
    return monthMemosAccumRef.current;
  }, [monthMemosQuery.data, monthStart, monthEnd]);

  const monthDiaryAccumRef = useRef<Set<string>>(new Set());
  const monthDiaryAccum = useMemo(() => {
    const data = monthDiaryQuery.data;
    if (data) monthDiaryAccumRef.current = mergeRangeSet(monthDiaryAccumRef.current, data, monthStart, monthEnd);
    return monthDiaryAccumRef.current;
  }, [monthDiaryQuery.data, monthStart, monthEnd]);

  const monthPhotoDiaryAccumRef = useRef<Set<string>>(new Set());
  const monthPhotoDiaryAccum = useMemo(() => {
    const data = monthPhotoDiaryQuery.data;
    if (data) monthPhotoDiaryAccumRef.current = mergeRangeSet(monthPhotoDiaryAccumRef.current, data, monthStart, monthEnd);
    return monthPhotoDiaryAccumRef.current;
  }, [monthPhotoDiaryQuery.data, monthStart, monthEnd]);

  const activeMemosByDate = viewMode === 'week' ? weekMemosByDate : monthMemosAccum;
  const activeData = viewMode === 'week' ? (weekQuery.data ?? null) : monthAccum;

  // 탭에 돌아올 때마다 지금 보고 있는 뷰(월 또는 주)의 데이터만 다시 불러온다 — 예전
  // useFocusEffect(if viewMode==='month' load(...) else loadWeek(...))와 동일한 범위
  const refetchActive = useCallback(() => {
    calendarRoutinesQuery.refetch();
    if (viewMode === 'month') {
      monthQuery.refetch();
      monthMemosQuery.refetch();
      monthDiaryQuery.refetch();
      monthPhotoDiaryQuery.refetch();
    } else {
      weekQuery.refetch();
      weekMemosQuery.refetch();
      weekDiaryQuery.refetch();
      weekPhotoDiaryQuery.refetch();
    }
    statsQuery.refetch();
  }, [
    viewMode,
    calendarRoutinesQuery.refetch,
    monthQuery.refetch,
    monthMemosQuery.refetch,
    monthDiaryQuery.refetch,
    monthPhotoDiaryQuery.refetch,
    weekQuery.refetch,
    weekMemosQuery.refetch,
    weekDiaryQuery.refetch,
    weekPhotoDiaryQuery.refetch,
    statsQuery.refetch,
  ]);
  useRefetchOnFocus(refetchActive, !!userId);

  // "다른 탭에 갔다가 캘린더 탭으로 다시 들어올 때" 항상 이번 주 주간뷰로 되돌리려는
  // 의도였는데, useFocusEffect는 diary-form처럼 캘린더 위에 잠깐 띄운 화면(스택 화면)에서
  // 뒤로 돌아올 때도 "포커스 재획득"으로 똑같이 잡혀서, 월간뷰에서 일기 보고 저장하고
  // 돌아오면 의도치 않게 주간뷰로 밀려나는 버그가 있었음. 하단 탭 아이콘을 실제로 눌렀을
  // 때만 발생하는 'tabPress' 이벤트로 바꿔서, 다른 탭에서 진짜로 넘어올 때만 리셋되게 한다
  const navigation = useNavigation();
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as never, () => {
      setViewMode('week');
      setWeekStart(formatLocalDate(sundayOf(new Date())));
      scrollWeekToTodayRef.current();
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollWeekToTodayRef.current()));
  }, [weekQuery.data]);

  // useCallback으로 안 감싸면 CalendarScreen이 리렌더될 때마다(트래킹 입력창 타이핑 등
  // 월간뷰와 무관한 상태 변화 포함) 이 함수가 매번 새로 만들어지고, CalendarList의
  // onMonthChange prop이 매번 바뀌면서 renderDay와 똑같은 이유로 CalendarListItem들이
  // 통째로 다시 그려지는 원인이 됐다(2026-09-21)
  const handleMonthChange = useCallback((date: DateData) => {
    setYear(date.year);
    setMonth(date.month);
  }, []);

  function shiftWeek(days: number) {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + days);
    setWeekStart(formatLocalDate(d));
  }

  // 월간뷰 좌우 스와이프: PanResponder → react-native-gesture-handler로 두 번 시도했지만
  // 둘 다 안드로이드 제스처 내비게이션 영역과 부딪혀서 앱이 통째로 튕겨 나가는 문제가 있었음.
  // 커스텀 제스처 코드로 계속 씨름하는 대신, 캘린더 라이브러리가 원래 지원하는 가로 스와이프 페이징
  // (CalendarList의 horizontal+pagingEnabled)으로 바꿔서 이 문제를 근본적으로 피해감.
  const screenWidth = Dimensions.get('window').width;

  // 주간뷰 좌우 스와이프도 같은 이유로 원복 — 화살표(‹ ›) 버튼으로만 주 이동
  const weekScrollRef = useRef<ScrollView>(null);

  // 주간뷰 가로 스크롤 커스텀 막대 — 기본 ScrollView 스크롤바는 색을 못 바꿔서(iOS는 흑/백만,
  // 안드로이드는 아예 불가) 직접 그린다. 칸 7개 폭은 고정값이라 콘텐츠 전체 폭은 계산으로
  // 바로 나오고, 보이는 영역 폭만 onLayout으로 측정한다.
  // 스크롤 위치는 매 프레임 바뀌는 값이라 useState로 들고 있으면 스크롤할 때마다 화면 전체가
  // 다시 그려져서 살짝 끊기는 느낌이 났음(2026-09-17) — Animated.Value로 바꿔서 네이티브
  // 쪽에서 곧바로 막대 위치에 반영되게 하고, 리액트 리렌더 자체가 안 일어나게 한다
  const weekScrollXAnim = useRef(new Animated.Value(0)).current;
  const [weekViewportWidth, setWeekViewportWidth] = useState(0);
  const weekContentWidth = WEEK_COLUMN_WIDTH * 7;
  // 월간뷰(CalendarList)가 실제로 차지하는 높이를 재서, 주간뷰 칸도 정확히 그 높이에
  // 맞춘다 — "화면 남는 공간을 다 채우기"(flex:1)로 했더니 월간뷰보다 훨씬 길게(범례가
  // 화면 맨 아래로 밀려남) 늘어나 버려서, 월간뷰의 실측값 하나로 통일하는 쪽으로 바꿨다.
  // 아직 월간뷰를 한 번도 안 봤으면(0) 기존 고정값과 비슷한 값으로 대체
  // 달마다 셀 내용(메모 표시 등)이 비동기로 늦게 채워지면서 월간뷰(CalendarList) 높이가
  // 계속 바뀌어 그 아래 범례("다완료/일부완료/필수놓침")가 자꾸 움직이던 문제 — 높이를
  // 이 고정값으로 못박아서(월간뷰 박스에 그대로 적용) 안 움직이게 하고, 주간뷰 칸 높이도
  // 같은 값 기준으로 계산해서 범례 위치가 두 모드에서 항상 똑같게 맞춘다
  const MONTH_CALENDAR_HEIGHT = 430;
  // 6줄짜리 달의 마지막 줄이 dayCell 높이를 줄인 뒤에도 여전히 살짝 잘려 보인다는 피드백
  // (2026-09-21) — react-native-calendars가 각 주 행 사이에 라이브러리 자체 여백을 얼마나
  // 두는지 정확히 알 수 없어서(커스텀 dayComponent라 우리가 그 여백까지 제어 못함), 칸
  // 높이 계산과는 별개로 캘린더를 실제로 담는 박스 자체에 여유 공간을 더 준다. 주간뷰
  // 높이(weekColumnTargetHeight)는 원래 값(MONTH_CALENDAR_HEIGHT) 기준 그대로 둬서
  // 이미 맞춰둔 두 모드 간 범례 위치는 안 흔들리게 한다
  const MONTH_GRID_HEIGHT = MONTH_CALENDAR_HEIGHT + 30;
  // 월간뷰에서 스트릭 카드(streakHeroOuter)를 숨기면서(2026-09-21) 그 카드는 이제 주간뷰에만
  // 남아있는데, 그만큼 주간뷰 전체 길이가 월간뷰보다 길어지고 범례("다완료/일부완료/필수놓침")
  // 위치도 그만큼 아래로 밀려버렸다 — 주간뷰 칸 높이를 스트릭 카드가 차지하는 높이만큼
  // (paddingVertical 20 + 내용 약 24px + marginBottom 10 ≈ 54) 추가로 줄여서, 범례가
  // 다시 월간뷰와 같은 세로 위치에 오도록 맞춘다
  const STREAK_CARD_HEIGHT = 54;
  const weekColumnTargetHeight = MONTH_CALENDAR_HEIGHT - 40 - STREAK_CARD_HEIGHT;

  // CalendarList의 theme prop을 매 렌더마다 새 객체 리터럴로 넘기면, renderDay를 고쳐도
  // 소용없이 그 자체로 CalendarListItem(React.memo)의 얕은 비교를 매번 깨뜨려서 체크/트래킹
  // 저장은 물론 트래킹 숫자를 한 글자 입력할 때마다도 월간뷰 전체가 다시 그려지고 있었다
  // (2026-09-21) — theme/accent가 실제로 바뀔 때만 새로 만들어지게 고정한다
  const calendarTheme = useMemo(
    () => ({
      calendarBackground: Colors[theme].background,
      dayTextColor: Colors[theme].text,
      monthTextColor: Colors[theme].text,
      textDisabledColor: theme === 'dark' ? '#555' : '#ccc',
      arrowColor: accent,
      todayTextColor: accent,
      // "2026년 9월" 제목·화살표(header)와 그 아래 요일 이름 줄(week)을 각각 따로 내리기 위한
      // 라이브러리 커스텀 키(react-native-calendars가 지원하는 'stylesheet.calendar.header'
      // 오버라이드). 달력 본문(week 아래로 이어지는 그리드)의 화면상 절대 위치는 그대로 두고
      // 제목만 5px 더 내리고 싶어서, header.marginTop을 5 늘리는 대신 week.marginTop을 그만큼
      // 줄여서 상쇄한다 — header 기본값 6+5=11, week는 기존 17(기본값7+10)에서 5 뺀 12.
      // 각 키를 통째로 덮어써야 해서 나머지 속성(flexDirection 등)도 라이브러리 기본값 그대로 같이 넣어준다
      'stylesheet.calendar.header': {
        header: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingLeft: 10,
          paddingRight: 10,
          marginTop: 11,
          alignItems: 'center',
        },
        week: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-around' },
      },
    }),
    [theme, accent]
  );

  // 요일 칸들이 실제로 화면에 그려지기 전에 scrollTo를 호출하면(useEffect가 너무 일찍 실행되면)
  // 아직 스크롤 가능한 콘텐츠 폭이 확보되지 않아 명령이 조용히 무시됨 — onContentSizeChange로
  // 실제 레이아웃이 잡힌 뒤에 스크롤하도록 타이밍을 맞춘다.
  // 주는 항상 일~토라 오늘 칸 위치가 요일마다 다름 — 지금 보이는 주에 오늘이 들어있을 때만
  // 그 칸이 화면 가운데쯤 오도록 스크롤(화살표로 다른 주로 이동했으면 이 계산은 건너뜀)
  function scrollWeekToToday() {
    const todayStr = formatLocalDate(new Date());
    const cursor = new Date(`${weekStart}T00:00:00`);
    let todayColumnIndex = -1;
    for (let i = 0; i < 7; i++) {
      if (formatLocalDate(cursor) === todayStr) {
        todayColumnIndex = i;
        break;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (todayColumnIndex === -1) {
      // 오늘이 없는 주(화살표로 다른 주로 이동한 경우)는 항상 맨 앞(일요일)부터 보이게 리셋한다 —
      // 안 그러면 이전 주에서 스크롤해뒀던 위치(예: 토요일 근처)가 새 주에도 그대로 남아있어서
      // 매번 직접 되돌려 스크롤해야 하는 불편함이 있었음
      weekScrollRef.current?.scrollTo({ x: 0, animated: false });
      return;
    }
    const targetX = Math.max(
      0,
      todayColumnIndex * WEEK_COLUMN_WIDTH + WEEK_COLUMN_WIDTH / 2 - screenWidth / 2
    );
    weekScrollRef.current?.scrollTo({ x: targetX, animated: false });
  }

  // scrollWeekToToday는 매 렌더마다 새로 만들어지는 함수라서, weekStart가 바뀔 때마다 최신 값을
  // 읽는다. 그런데 loadWeek는 deps를 [userId]로만 좁혀둔 useCallback이라 처음 만들어질 때(=화면을
  // 맨 처음 열었을 때) 클로저에 잡힌 scrollWeekToToday를 계속 재사용한다 — 그 안에 든 weekStart는
  // 그때의(=오늘이 들어있는 처음 주) 값 그대로 박제됨. 그 결과 화살표로 다른 주로 이동해도
  // loadWeek가 부르는 scrollWeekToToday는 항상 "처음 열었을 때 주의 오늘 요일" 위치를 계산해서,
  // 어느 주로 이동하든 늘 같은 요일(예: 오늘이 토요일이면 항상 토요일)로 스크롤되는 버그가 있었음.
  // 최신 함수를 ref에 담아두고 loadWeek 등에서는 이 ref를 통해서만 호출하면 이 문제가 없어진다
  const scrollWeekToTodayRef = useRef(scrollWeekToToday);
  useEffect(() => {
    scrollWeekToTodayRef.current = scrollWeekToToday;
  });

  // 체크형 토글 — 오늘뿐 아니라 지난 날짜(깜빡하고 못 한 날)도 여기서 처리한다. 서버 응답을
  // 기다리는 동안 화면이 그대로라 "누르면 렉 걸린 것처럼 잘 안 된다"는 느낌이 있었음(오늘
  // 탭은 이미 낙관적 업데이트를 쓰고 있었는데 캘린더 쪽만 빠져있었다) — 결과를 기다리지 않고
  // 먼저 화면부터 바꾼 뒤, 서버 응답이 오면 진짜 값으로 다시 맞추고, 실패하면 원래대로 되돌린다
  async function handleToggleCompletionForDate(routineId: string, existingCompletionId: string | null, date: string) {
    const monthKey = ['month-data', userId, year, month] as const;
    const weekKey = ['week-data', userId, weekStart] as const;
    const applyUpdate = (prev: MonthData | undefined, result: RoutineCompletion | null) => {
      if (!prev) return prev;
      const routineMap = { ...(prev.completionsByRoutine[routineId] ?? {}) };
      if (result) {
        routineMap[result.completed_date] = result;
      } else {
        delete routineMap[date];
      }
      return {
        ...prev,
        completionsByRoutine: { ...prev.completionsByRoutine, [routineId]: routineMap },
      };
    };

    const prevMonth = queryClient.getQueryData<MonthData>(monthKey);
    const prevWeek = queryClient.getQueryData<MonthData>(weekKey);
    const optimisticResult: RoutineCompletion | null = existingCompletionId
      ? null
      : { id: `optimistic-${Date.now()}`, routine_id: routineId, completed_date: date, tracking_value: null };
    queryClient.setQueryData(monthKey, (prev?: MonthData) => applyUpdate(prev, optimisticResult));
    queryClient.setQueryData(weekKey, (prev?: MonthData) => applyUpdate(prev, optimisticResult));

    try {
      const result = await toggleCheckCompletion(routineId, existingCompletionId, date);
      queryClient.setQueryData(monthKey, (prev?: MonthData) => applyUpdate(prev, result));
      queryClient.setQueryData(weekKey, (prev?: MonthData) => applyUpdate(prev, result));
      queryClient.invalidateQueries({ queryKey: ['stats', userId] });
    } catch {
      queryClient.setQueryData(monthKey, prevMonth);
      queryClient.setQueryData(weekKey, prevWeek);
      setErrorMessage(t('calendar.errorCheck'));
    }
  }

  // 트래킹형 저장 — 값이 있으면 기록을 만들거나 갱신하고, 지우고 빈 채로 저장하면(오늘 탭과
  // 동일한 정책) 기록삭제로 처리한다. 오늘뿐 아니라 지난 날짜도 여기서 같이 처리
  async function handleSaveTrackingForDate(routineId: string, existingCompletionId: string | null, date: string) {
    const raw = trackingDraft;
    const value = Number(raw);
    setEditingTrackingRoutineId(null);
    if (!raw || Number.isNaN(value)) {
      if (existingCompletionId) await handleToggleCompletionForDate(routineId, existingCompletionId, date);
      return;
    }
    const monthKey = ['month-data', userId, year, month] as const;
    const weekKey = ['week-data', userId, weekStart] as const;
    const applyUpdate = (prev: MonthData | undefined, result: RoutineCompletion) => {
      if (!prev) return prev;
      const routineMap = { ...(prev.completionsByRoutine[routineId] ?? {}) };
      routineMap[result.completed_date] = result;
      return { ...prev, completionsByRoutine: { ...prev.completionsByRoutine, [routineId]: routineMap } };
    };

    // 여기도 체크형과 마찬가지로 서버 응답을 기다리는 동안 화면이 그대로라 느리게 느껴졌음 —
    // 입력을 닫는 순간 바로 "저장된 값"으로 먼저 보여주고, 실패하면 원래대로 되돌린다
    const prevMonth = queryClient.getQueryData<MonthData>(monthKey);
    const prevWeek = queryClient.getQueryData<MonthData>(weekKey);
    const optimisticResult: RoutineCompletion = {
      id: existingCompletionId ?? `optimistic-${Date.now()}`,
      routine_id: routineId,
      completed_date: date,
      tracking_value: value,
    };
    queryClient.setQueryData(monthKey, (prev?: MonthData) => applyUpdate(prev, optimisticResult));
    queryClient.setQueryData(weekKey, (prev?: MonthData) => applyUpdate(prev, optimisticResult));

    try {
      const result = await saveTrackingValue(routineId, existingCompletionId, value, date);
      queryClient.setQueryData(monthKey, (prev?: MonthData) => applyUpdate(prev, result));
      queryClient.setQueryData(weekKey, (prev?: MonthData) => applyUpdate(prev, result));
      queryClient.invalidateQueries({ queryKey: ['stats', userId] });
    } catch {
      queryClient.setQueryData(monthKey, prevMonth);
      queryClient.setQueryData(weekKey, prevWeek);
      setErrorMessage(t('calendar.errorCheck'));
    }
  }

  function startEditMemo(memo: DateMemo) {
    setEditingMemoId(memo.id);
    setMemoText(memo.content);
    setMemoColor(memo.color);
  }

  async function handleSubmitMemo() {
    if (!selectedDate || !userId) return;
    const text = memoText.trim();
    if (!text) return;
    try {
      if (editingMemoId) {
        const updated = await updateMemo(editingMemoId, text, memoColor);
        queryClient.setQueryData(activeMemoQueryKey, (prev?: DateMemo[]) =>
          (prev ?? []).map((m) => (m.id === updated.id ? updated : m))
        );
      } else {
        const created = await createMemo(userId, selectedDate, text, memoColor);
        queryClient.setQueryData(activeMemoQueryKey, (prev?: DateMemo[]) => [...(prev ?? []), created]);
      }
      setMemoText('');
      setMemoColor('yellow');
      setEditingMemoId(null);
      syncSlotAlarms(userId).catch(() => {});
    } catch {
      setErrorMessage(t('calendar.errorSaveMemo'));
    }
  }

  async function handleDeleteMemo(memoId: string) {
    if (!selectedDate) return;
    try {
      await deleteMemo(memoId);
      queryClient.setQueryData(activeMemoQueryKey, (prev?: DateMemo[]) => (prev ?? []).filter((m) => m.id !== memoId));
      if (editingMemoId === memoId) {
        setEditingMemoId(null);
        setMemoText('');
      }
      if (userId) syncSlotAlarms(userId).catch(() => {});
    } catch {
      setErrorMessage(t('calendar.errorDeleteMemo'));
    }
  }

  const todayStr = formatLocalDate(today);

  const detail = selectedDate && activeData ? routinesForDate(selectedDate, activeData) : [];
  const selectedMemos = selectedDate ? activeMemosByDate[selectedDate] ?? [] : [];

  // 트래킹 입력 중 바깥을 탭하거나 목록을 스크롤하면 키보드를 내리면서 입력을 마무리한다 —
  // handleSaveTrackingForDate가 이미 "빈 값이면 기록삭제로 취급"하는 로직을 갖고 있어서,
  // 숫자를 안 적은 채로 나가면 자동으로 미기록 상태로 되돌아간다(2026-09-21)
  function commitOrCancelTrackingEdit() {
    if (!editingTrackingRoutineId || !selectedDate) return;
    const entry = detail.find((d) => d.routine.id === editingTrackingRoutineId);
    handleSaveTrackingForDate(editingTrackingRoutineId, entry?.completion?.id ?? null, selectedDate);
  }

  const weekDates: string[] = [];
  if (viewMode === 'week') {
    const start = new Date(`${weekStart}T00:00:00`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      weekDates.push(formatLocalDate(d));
    }
  }
  const weekEndLabel = weekDates.length > 0 ? weekDates[6].slice(5).replace('-', '/') : '';
  const weekStartLabel = weekStart.slice(5).replace('-', '/');

  // 커스텀 가로 스크롤 막대의 크기 — 보이는 영역 폭 대비 전체 콘텐츠 폭 비율로 길이를 정한다.
  // 위치(translateX)는 아래 JSX에서 weekScrollXAnim을 그대로 interpolate해서 구한다(리렌더 없이
  // 네이티브에서 바로 반영되게 하기 위해 여기서 숫자로 미리 계산해두지 않는다)
  const weekThumbWidth = Math.max(24, weekViewportWidth * (weekViewportWidth / weekContentWidth));
  const weekMaxScrollX = Math.max(1, weekContentWidth - weekViewportWidth);
  const weekThumbMaxTranslate = Math.max(0, weekViewportWidth - weekThumbWidth);

  // 범례("다완료/일부완료/필수놓침") 박스를 좌우로 스와이프하면 주/월 보기가 바뀐다(2026-09-21).
  // 예전에 캘린더 전체(화면 가로 전체 폭)에 커스텀 스와이프를 걸었을 때 안드로이드 시스템
  // 뒤로가기 제스처(화면 양 끝에서 시작하는 스와이프)와 계속 충돌해서 실패한 적이 있어서
  // (docs/study.md 2026-08-27), 이번엔 화면 양 끝에 안 닿도록 좌우 여백을 준 좁은 박스
  // 하나에만 제스처를 걸어 그 문제를 피한다 — 달력 그리드 자체나 리스트는 건드리지 않는다
  // 월간뷰로 들어갈 때마다 예전에 보던 달이 아니라 항상 지금 달부터 보여준다 — 탭으로
  // 들어갈 때와 스와이프로 들어갈 때가 똑같이 동작하도록 함수 하나로 공유한다
  function goToMonthView() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    setYear(y);
    setMonth(m);
    setCalendarCursor(`${y}-${String(m).padStart(2, '0')}-01`);
    setViewMode('month');
  }
  // FAB 드래그(오늘 탭의 fabPan)와 같은 방식으로 onEnd는 UI스레드 워클릿으로 두고 runOnJS로
  // JS 함수를 직접 호출한다 — 제스처 빌더의 .runOnJS(true) 방식은 이 프로젝트에서 실제로
  // 안 먹혔다(2026-09-21, 폰 실기에서 스와이프 자체가 인식 안 되는 문제로 확인됨)
  function handleViewModeSwipe(translationX: number) {
    if (translationX < -40) goToMonthView();
    else if (translationX > 40) setViewMode('week');
  }
  // 위(탭 박스)와 아래(범례+그 밑 빈 공간) 두 군데에 같은 동작을 걸되, 하나의 제스처
  // 인스턴스를 두 GestureDetector에 같이 물리면 충돌할 수 있어 각자 따로 만든다(2026-09-21) —
  // 달력 그리드/주간뷰 칸(실제로 탭해서 날짜를 고르는 부분)만 빼고 나머지는 전부 스와이프되게
  // 범위를 넓혀달라는 요청으로, 탭 박스와 범례 박스를 스와이프 영역으로 잡았다
  const viewModeSwipeGestureTop = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      runOnJS(handleViewModeSwipe)(e.translationX);
    });
  const viewModeSwipeGestureBottom = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      runOnJS(handleViewModeSwipe)(e.translationX);
    });

  return (
    <View style={styles.container}>
      <GestureDetector gesture={viewModeSwipeGestureTop}>
        <View style={styles.viewModeTabs}>
          <AnimatedPressable
            style={[styles.viewModeTab, viewMode === 'week' && styles.viewModeTabActive]}
            onPress={() => setViewMode('week')}>
            <Text style={[styles.viewModeTabText, viewMode === 'week' && styles.viewModeTabTextActive]}>{t('calendar.week')}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.viewModeTab, viewMode === 'month' && styles.viewModeTabActive]}
            onPress={goToMonthView}>
            <Text style={[styles.viewModeTabText, viewMode === 'month' && styles.viewModeTabTextActive]}>{t('calendar.month')}</Text>
          </AnimatedPressable>
        </View>
      </GestureDetector>

      {/* 폰이 작으면 주간 캘린더가 안 보일 정도로 이 카드가 커 보인다는 피드백 — 위아래로
          쌓던(라벨 위, 숫자 아래) 레이아웃을 한 줄로 합치고 크기를 확 줄여서, 아래 실제
          캘린더가 차지할 세로 공간을 더 확보한다.
          월간뷰는 요청으로 이 카드를 다시 숨긴다(2026-09-21) — 예전엔 범례 위치를 주간뷰와
          맞추려고 두 모드 모두 보여줬지만, 월간뷰 높이는 이제 MONTH_CALENDAR_HEIGHT 고정값
          하나로만 관리되므로 이 카드가 없어도 월간뷰 자체 높이는 안 흔들린다 */}
      {viewMode === 'week' && (
        <ShadowCard style={styles.streakHeroOuter} contentStyle={styles.streakHero}>
          {bestStreakEver !== null && bestStreakEver > 0 ? (
            <View style={styles.streakHeroRow}>
              <Text style={styles.streakHeroLabel}>BEST STREAK</Text>
              <View style={styles.streakHeroNumRow}>
                <Text style={styles.streakHeroNum}>{bestStreakEver}</Text>
                <Text style={styles.streakHeroUnit}>{t('calendar.streakUnit')}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.streakBadgeEmptyText}>{t('calendar.noStreakYet')}</Text>
          )}
        </ShadowCard>
      )}

      {viewMode === 'month' && (
        <MonthCalendarSection
          height={MONTH_GRID_HEIGHT}
          screenWidth={screenWidth}
          calendarCursor={calendarCursor}
          calendarTheme={calendarTheme}
          onMonthChange={handleMonthChange}
          monthAccum={deferredMonthAccum}
          monthMemosAccum={monthMemosAccum}
          monthDiaryAccum={monthDiaryAccum}
          monthPhotoDiaryAccum={monthPhotoDiaryAccum}
          selectedDate={deferredSelectedDate}
          theme={theme}
          todayStr={todayStr}
          accent={accent}
          styles={styles}
          onSelectDate={setSelectedDate}
        />
      )}
      {viewMode === 'week' && (
        <View style={styles.weekContainer}>
          <View style={styles.weekHeader}>
            <AnimatedPressable onPress={() => shiftWeek(-7)} hitSlop={8}>
              <Text style={styles.weekArrow}>‹</Text>
            </AnimatedPressable>
            <Text style={styles.weekRangeText}>
              {weekStartLabel} - {weekEndLabel}
            </Text>
            <AnimatedPressable onPress={() => shiftWeek(7)} hitSlop={8}>
              <Text style={styles.weekArrow}>›</Text>
            </AnimatedPressable>
          </View>

          <Animated.ScrollView
            ref={weekScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onLayout={(e) => setWeekViewportWidth(e.nativeEvent.layout.width)}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: weekScrollXAnim } } }], {
              useNativeDriver: true,
            })}
            scrollEventThrottle={16}
            onContentSizeChange={scrollWeekToToday}>
            {weekDates.map((dateStr) => {
              const isFuture = dateStr > todayStr;
              // weekData가 아직 안 왔어도(막 로딩 중이어도) 칸 자체는 항상 바로 그려지게 하고,
              // 완료 색상/일정만 데이터가 도착하는 대로 채워 넣는다(스피너로 화면을 막지 않기 위함)
              const weekData = weekQuery.data;
              const status = weekData && !isFuture ? computeDayStatus(dateStr, weekData) : null;
              const dayNum = Number(dateStr.slice(8, 10));
              const scheduled = weekData && !isFuture ? routinesForDate(dateStr, weekData) : [];
              // 컬럼 위치(index)가 아니라 그 날짜의 실제 요일로 라벨을 정한다(항상 일요일 시작이라
              // 지금은 index와 같지만, 혼동 없게 날짜에서 직접 계산)
              const dow = new Date(`${dateStr}T00:00:00`).getDay();
                return (
                  <AnimatedPressable
                    key={dateStr}
                    style={[
                      styles.weekColumn,
                      dateStr === todayStr && styles.weekColumnToday,
                      // minHeight는 바닥값일 뿐이라 루틴이 많은 날은 칸이 그만큼 더 길어져서
                      // 요일마다 칸 높이가 들쭉날쭉해지던 버그가 있었음 — height로 고정해서
                      // 루틴 개수와 무관하게 항상 같은 높이가 되게 한다(넘치는 목록은 내부
                      // ScrollView가 이미 알아서 스크롤 처리한다)
                      { height: weekColumnTargetHeight },
                    ]}
                    onPress={() => setSelectedDate(dateStr)}>
                    <View style={styles.weekColumnHeader}>
                      <View style={styles.diaryIconSlot}>
                        {weekPhotoDiaryDates.has(dateStr) ? (
                          <Ionicons name="camera-outline" size={10} color={textMuted} />
                        ) : (
                          weekDiaryDates.has(dateStr) && <Ionicons name="book-outline" size={10} color={textMuted} />
                        )}
                      </View>
                      <Text style={styles.weekRowWeekday}>{t(WEEKDAY_KEYS[dow])}</Text>
                      <Text style={styles.weekRowDay}>{dayNum}</Text>
                      {status && <View style={[styles.weekStatusDot, { backgroundColor: STATUS_COLORS[status] }]} />}
                      {(weekMemosByDate[dateStr] ?? []).length > 0 && (
                        <View style={styles.weekMemoRow}>
                          {(weekMemosByDate[dateStr] ?? []).slice(0, 5).map((memo) => (
                            <View
                              key={memo.id}
                              style={[styles.weekMemoDot, { backgroundColor: MEMO_COLORS[memo.color].border }]}
                            />
                          ))}
                        </View>
                      )}
                    </View>
                    <ScrollView
                      style={[styles.weekColumnBody, { maxHeight: weekColumnTargetHeight - 44 }]}
                      nestedScrollEnabled>
                      {scheduled.length === 0 ? (
                        <Text style={styles.weekColumnEmpty}>{isFuture ? '' : '-'}</Text>
                      ) : (
                        scheduled.map(({ routine, completion }) => (
                          <Text
                            key={routine.id}
                            style={[styles.weekChip, completion && styles.weekChipDone]}
                            numberOfLines={1}>
                            {completion ? '✓ ' : ''}
                            {routine.title}
                          </Text>
                        ))
                      )}
                    </ScrollView>
                  </AnimatedPressable>
                );
              })}
          </Animated.ScrollView>
          {weekViewportWidth > 0 && weekContentWidth > weekViewportWidth && (
            <View style={styles.weekScrollTrack} pointerEvents="none">
              <Animated.View
                style={[
                  styles.weekScrollThumb,
                  {
                    width: weekThumbWidth,
                    transform: [
                      {
                        translateX: weekScrollXAnim.interpolate({
                          inputRange: [0, weekMaxScrollX],
                          outputRange: [0, weekThumbMaxTranslate],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>
          )}
        </View>
      )}

      {/* 범례 박스뿐 아니라 그 아래 화면 끝까지 남는 빈 공간까지 전부(flex:1) 스와이프
          영역으로 잡는다 — "달력 그리드/주간 칸(실제 탭 대상)만 빼고 나머지는 다 되게"라는
          요청(2026-09-21). 화면 양 끝에는 안 닿도록 좌우 여백만 유지해서 안드로이드 시스템
          뒤로가기 제스처 영역과는 안 겹치게 한다 */}
      <GestureDetector gesture={viewModeSwipeGestureBottom}>
        <View style={styles.legendSwipeZone}>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.done }]} />
              <Text style={styles.legendText}>{t('calendar.legendDone')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.partial }]} />
              <Text style={styles.legendText}>{t('calendar.legendPartial')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.missed_required }]} />
              <Text style={styles.legendText}>{t('calendar.legendMissed')}</Text>
            </View>
          </View>
        </View>
      </GestureDetector>

      <Modal
        visible={selectedDate !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedDate(null)}>
        <View style={styles.modalContainer}>
          <AnimatedPressable
            style={[StyleSheet.absoluteFill, styles.modalBackdrop]}
            onPress={() => setSelectedDate(null)}
          />
          {/* 트래킹 입력 중 바깥(리스트 빈 공간·헤더 등)을 탭하면 입력을 마무리하고 키보드를
              내린다 — 실제 버튼/행은 더 안쪽에 있는 자기 자신의 Pressable이 터치를 먼저
              가져가므로 이 바깥 탭 처리와 안 부딪힌다(2026-09-21) */}
          <TouchableWithoutFeedback onPress={commitOrCancelTrackingEdit}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedDate}</Text>
              <AnimatedPressable
                style={styles.diaryButton}
                onPress={() => {
                  const date = selectedDate;
                  setSelectedDate(null);
                  if (date) router.push({ pathname: '/diary-form', params: { date } });
                }}>
                <Ionicons name="book-outline" size={13} color={accent} />
                <Text style={styles.diaryButtonText}>{t('calendar.viewDiary')}</Text>
              </AnimatedPressable>
            </View>
            {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

            <ScrollView
              style={styles.detailList}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScrollBeginDrag={commitOrCancelTrackingEdit}>
              <View style={styles.sectionLabelRow}>
                <Ionicons name="bookmark-outline" size={13} color={Colors[theme].text} style={{ opacity: 0.7 }} />
                <Text style={styles.sectionLabel}>{t('calendar.memoSection')}</Text>
              </View>
              {selectedMemos.length === 0 ? (
                <Text style={styles.memoEmptyText}>{t('calendar.noMemo')}</Text>
              ) : (
                selectedMemos.map((memo) => (
                  <View
                    key={memo.id}
                    style={[
                      styles.memoCard,
                      { backgroundColor: MEMO_COLORS[memo.color].bg, borderColor: MEMO_COLORS[memo.color].border },
                    ]}>
                    <Text style={styles.memoCardText}>{memo.content}</Text>
                    <View style={styles.memoCardActions}>
                      <AnimatedPressable onPress={() => startEditMemo(memo)} hitSlop={6}>
                        <Text style={styles.memoActionText}>{t('calendar.memoEdit')}</Text>
                      </AnimatedPressable>
                      <AnimatedPressable onPress={() => handleDeleteMemo(memo.id)} hitSlop={6}>
                        <Text style={styles.memoActionText}>{t('calendar.memoDelete')}</Text>
                      </AnimatedPressable>
                    </View>
                  </View>
                ))
              )}

              <View style={styles.memoColorPicker}>
                {MEMO_COLOR_ORDER.map((c) => (
                  <AnimatedPressable
                    key={c}
                    onPress={() => setMemoColor(c)}
                    style={[
                      styles.memoColorSwatch,
                      { backgroundColor: MEMO_COLORS[c].border },
                      memoColor === c && styles.memoColorSwatchActive,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.memoAddRow}>
                <TextInput
                  style={[styles.memoInput, { color: Colors[theme].text }]}
                  placeholder={t('calendar.memoPlaceholder')}
                  placeholderTextColor="#999"
                  value={memoText}
                  onChangeText={setMemoText}
                  onSubmitEditing={handleSubmitMemo}
                />
                <AnimatedPressable style={styles.memoAddButton} onPress={handleSubmitMemo}>
                  <Text style={styles.memoAddButtonText}>
                    {editingMemoId ? t('calendar.memoEditComplete') : t('calendar.memoAdd')}
                  </Text>
                </AnimatedPressable>
              </View>
              {editingMemoId && (
                <AnimatedPressable
                  onPress={() => {
                    setEditingMemoId(null);
                    setMemoText('');
                    setMemoColor('yellow');
                  }}>
                  <Text style={styles.memoCancelEdit}>{t('calendar.memoCancelEdit')}</Text>
                </AnimatedPressable>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>{t('calendar.todayRoutines')}</Text>
              {detail.length === 0 ? (
                <Text style={styles.emptyText}>{t('calendar.noRoutinesThisDay')}</Text>
              ) : (
                detail.map(({ routine, completion }) => {
                  // 오늘뿐 아니라 지난 날짜도 체크/기록할 수 있어야 한다 — 깜빡하고 못 한 걸
                  // 다음날 뒤늦게 표시하고 싶을 수 있으니까. 미래 날짜는 아직 안 일어난 일이라 제외
                  const isPastOrToday = selectedDate !== null && selectedDate <= todayStr;
                  const isCheckToggleable = isPastOrToday && routine.block_type === 'check';
                  const isTrackingEditable = isPastOrToday && routine.block_type === 'tracking';
                  const isEditingThisTracking = editingTrackingRoutineId === routine.id;

                  const mainInfo = (
                    <View style={styles.detailMain}>
                      <Text style={styles.detailTitle}>
                        {routine.title}
                        {routine.is_required && <Text style={styles.detailRequired}> *필수</Text>}
                      </Text>
                      <Text style={styles.detailTime}>{timeLabel(routine, t)}</Text>
                    </View>
                  );

                  if (isEditingThisTracking && selectedDate) {
                    return (
                      <View key={routine.id} style={styles.detailRow}>
                        {mainInfo}
                        <TextInput
                          autoFocus
                          style={[styles.detailTrackingInput, { color: Colors[theme].text }]}
                          keyboardType="numeric"
                          value={trackingDraft}
                          onChangeText={setTrackingDraft}
                          placeholder="0"
                          placeholderTextColor="#999"
                          onSubmitEditing={() =>
                            handleSaveTrackingForDate(routine.id, completion?.id ?? null, selectedDate)
                          }
                        />
                        <Text style={styles.detailUnit} numberOfLines={1}>
                          {truncateTrackingUnit(routine.tracking_unit)}
                        </Text>
                      </View>
                    );
                  }

                  const row = (
                    <View style={styles.detailRow}>
                      {routine.block_type === 'check' ? (
                        <View style={[styles.detailCheckbox, completion && styles.detailCheckboxDone]}>
                          {completion && <Text style={styles.detailCheckmark}>✓</Text>}
                        </View>
                      ) : null}
                      {mainInfo}
                      {routine.block_type === 'tracking' &&
                        (completion?.tracking_value != null ? (
                          <Text style={[styles.detailValue, isTrackingEditable && { color: accent }]} numberOfLines={1}>
                            ✓ {completion.tracking_value} {truncateTrackingUnit(routine.tracking_unit)}
                          </Text>
                        ) : isTrackingEditable ? (
                          <Text style={styles.detailTrackingPlaceholder}>탭해서 입력</Text>
                        ) : null)}
                    </View>
                  );

                  if (isCheckToggleable) {
                    return (
                      <AnimatedPressable
                        key={routine.id}
                        onPress={() =>
                          selectedDate && handleToggleCompletionForDate(routine.id, completion?.id ?? null, selectedDate)
                        }>
                        {row}
                      </AnimatedPressable>
                    );
                  }
                  if (isTrackingEditable) {
                    return (
                      <AnimatedPressable
                        key={routine.id}
                        onPress={() => {
                          setEditingTrackingRoutineId(routine.id);
                          setTrackingDraft(completion?.tracking_value != null ? String(completion.tracking_value) : '');
                        }}>
                        {row}
                      </AnimatedPressable>
                    );
                  }
                  return <View key={routine.id}>{row}</View>;
                })
              )}
            </ScrollView>
            {/* 트래킹 입력 중엔 키보드가 뜨면서 이 버튼이 바로 그 위로 밀려 올라와 어색하게
                보이던 문제가 있었다(2026-09-21) — 입력 중엔 아예 숨기고, 목록 스크롤/바깥
                탭으로 입력이 끝나면(commitOrCancelTrackingEdit) 다시 나타난다 */}
            {!editingTrackingRoutineId && (
              <AnimatedPressable style={styles.closeButton} onPress={() => setSelectedDate(null)}>
                <Text style={styles.closeButtonText}>{t('today.close')}</Text>
              </AnimatedPressable>
            )}
          </View>
          </TouchableWithoutFeedback>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 24,
  },
  viewModeTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 31,
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
  streakHeroOuter: {
    marginHorizontal: 20,
    marginBottom: 10,
  },
  streakHero: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  streakHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  streakHeroLabel: {
    fontFamily: fontMono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: textMuted,
  },
  streakHeroNumRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  streakHeroNum: {
    fontFamily: fontDisplay,
    fontSize: 22,
    color: accent,
  },
  streakHeroUnit: {
    fontSize: 12,
    color: textMuted,
  },
  streakBadgeEmptyText: {
    fontSize: 11,
    opacity: 0.35,
  },
  weekContainer: {
    paddingHorizontal: 20,
  },
  weekScrollTrack: {
    height: 3,
    marginTop: 4,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  weekScrollThumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: withAlpha(accent, 0.5),
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 10,
  },
  weekArrow: {
    fontSize: 20,
    color: accent,
    fontWeight: '700',
    paddingHorizontal: 12,
  },
  weekRangeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  weekColumn: {
    width: WEEK_COLUMN_WIDTH - 6,
    // 위 스트릭 카드를 줄여서 생긴 여유만큼, 폰이 작아도 주간 캘린더 자체가 눈에 잘 들어오도록 키움
    minHeight: 230,
    marginRight: 6,
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  weekColumnToday: {
    borderColor: accent,
    backgroundColor: 'rgba(169, 196, 224, 0.06)',
  },
  weekColumnHeader: {
    alignItems: 'center',
    marginBottom: 8,
    gap: 2,
  },
  weekColumnBody: {
    minHeight: 130,
    maxHeight: 210,
  },
  weekColumnEmpty: {
    fontSize: 11,
    opacity: 0.3,
    textAlign: 'center',
  },
  weekChip: {
    fontSize: 11 + fontKorean.sizeAdjust,
    lineHeight: 15 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 3,
    borderRadius: cardRadius,
    backgroundColor: 'rgba(169, 196, 224, 0.08)',
  },
  weekChipDone: {
    opacity: 0.5,
    textDecorationLine: 'line-through',
  },
  weekRowWeekday: {
    fontSize: 11,
    opacity: 0.5,
  },
  weekRowDay: {
    fontSize: 15,
    fontWeight: '700',
  },
  weekStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  weekMemoRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
  },
  weekMemoDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dayCell: {
    width: 44,
    minHeight: 46,
    alignItems: 'center',
    paddingTop: 2,
  },
  diaryIconSlot: {
    height: 12,
    justifyContent: 'center',
  },
  diaryIcon: {
    fontSize: 10,
  },
  dayNumberWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dayNumberText: {
    fontSize: 14,
  },
  // 공휴일 표시 점 — 색 자체의 채도/명도와 무관하게 "점이 있다/없다"만으로 항상 구분되게 한다
  holidayDot: {
    position: 'absolute',
    bottom: -4,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  memoStack: {
    marginTop: 3,
    gap: 2,
    width: 30,
  },
  memoBar: {
    height: 3,
    borderRadius: 2,
    borderWidth: 0.5,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  // 범례 박스 그 자체를 넘어, 그 아래 화면 끝까지 남는 빈 공간 전체를 스와이프 영역으로
  // 확보한다(flex:1) — 스와이프 범위가 너무 좁다는 피드백(2026-09-21). 좌우는 화면 양 끝에서
  // 떨어뜨려서(marginHorizontal) 안드로이드 시스템 뒤로가기 제스처 영역과는 안 겹치게 한다
  legendSwipeZone: {
    flex: 1,
    marginHorizontal: 18,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    opacity: 0.7,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    height: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  diaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  diaryButtonText: {
    color: accent,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    opacity: 0.5,
  },
  error: {
    color: '#FF6B6B',
    marginBottom: 8,
  },
  detailList: {
    flex: 1,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.7,
  },
  memoEmptyText: {
    fontSize: 12,
    opacity: 0.4,
    marginBottom: 8,
  },
  memoCard: {
    borderWidth: 1,
    borderRadius: cardRadius,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  memoCardText: {
    flex: 1,
    fontSize: 13 + fontKorean.sizeAdjust,
    lineHeight: 18 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  memoCardActions: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
  },
  memoActionText: {
    fontSize: 12,
    opacity: 0.7,
    fontWeight: '600',
  },
  memoColorPicker: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  memoColorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  memoColorSwatchActive: {
    borderWidth: 2,
    borderColor: '#333',
  },
  memoAddRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  memoInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13 + fontKorean.sizeAdjust,
    lineHeight: 18 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  memoAddButton: {
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  memoAddButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  memoCancelEdit: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 6,
    textDecorationLine: 'underline',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  detailCheckbox: {
    width: 24,
    height: 24,
    borderRadius: cardRadius,
    borderWidth: 1.5,
    borderColor: border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCheckboxDone: {
    backgroundColor: statusDone,
    borderColor: statusDone,
  },
  detailCheckmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  detailMain: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 15 + fontKorean.sizeAdjust,
    lineHeight: 20 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  detailRequired: {
    fontSize: 12,
    color: '#FF6B6B',
  },
  detailTime: {
    fontSize: 12,
    opacity: 0.6,
    fontFamily: fontMono,
  },
  // 트래킹 기록값 표시가 앞의 제목(detailMain, flex:1)이 나머지 공간을 다 차지한 뒤 남는
  // 자리에 붙다 보니, 값 길이가 저마다 달라 시작 위치(왼쪽)가 행마다 들쭉날쭉해 보였다
  // (2026-09-21) — 고정폭을 줘서 항상 같은 자리에서 시작하게 한다("탭해서 입력" placeholder도 동일)
  detailValue: {
    width: 100,
    fontSize: 13,
  },
  detailTrackingPlaceholder: {
    width: 100,
    fontSize: 12,
    color: accent,
    opacity: 0.7,
  },
  detailTrackingInput: {
    width: 60,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: 'right',
  },
  // 단위 글자 길이가 들쭉날쭉하면 그때그때 옆의 입력칸 위치가 흔들려 보인다(2026-09-21) —
  // 고정폭을 줘서 입력칸은 항상 같은 자리에 있고 단위만 그 오른쪽 고정 자리에 채워지게 한다
  detailUnit: {
    width: 32,
    fontSize: 12,
    opacity: 0.6,
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: accent,
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  });
}
