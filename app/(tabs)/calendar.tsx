import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { CalendarList, type DateData } from 'react-native-calendars';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuth } from '@/lib/auth-context';
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
import { syncSlotAlarms } from '@/lib/notifications';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
import {
  computeDayStatus,
  fetchStats,
  formatLocalDate,
  routinesForDate,
  fetchMonthData,
  fetchWeekData,
  toggleCheckCompletion,
  SLOT_LABELS,
  type DayStatus,
  type MonthData,
} from '@/lib/routines';

const STATUS_COLORS: Record<DayStatus, string> = {
  done: '#4CAF50',
  partial: '#FFA726',
  missed_required: '#FF6B6B',
};

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_COLUMN_WIDTH = 86; // weekColumn 스타일의 width(80) + marginRight(6)

function timeLabel(routine: MonthData['routines'][number]): string {
  if (routine.is_instant && routine.scheduled_time_start) {
    return routine.scheduled_time_start.slice(0, 5);
  }
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
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


export default function CalendarScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const theme = useColorScheme() ?? 'light';
  const router = useRouter();
  const queryClient = useQueryClient();

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
  const monthQuery = useQuery({
    queryKey: ['month-data', userId, year, month],
    queryFn: () => fetchMonthData(userId!, year, month),
    enabled: !!userId && viewMode === 'month',
  });
  const weekQuery = useQuery({
    queryKey: ['week-data', userId, weekStart],
    queryFn: () => fetchWeekData(userId!, weekStart),
    enabled: !!userId && viewMode === 'week',
  });
  const activeData = viewMode === 'week' ? (weekQuery.data ?? null) : (monthQuery.data ?? null);

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

  const monthMemosByDate = useMemo(() => groupMemosByDate(monthMemosQuery.data ?? []), [monthMemosQuery.data]);
  const monthDiaryDates = useMemo(() => new Set(monthDiaryQuery.data ?? []), [monthDiaryQuery.data]);
  const weekMemosByDate = useMemo(() => groupMemosByDate(weekMemosQuery.data ?? []), [weekMemosQuery.data]);
  const weekDiaryDates = useMemo(() => new Set(weekDiaryQuery.data ?? []), [weekDiaryQuery.data]);
  const activeMemosByDate = viewMode === 'week' ? weekMemosByDate : monthMemosByDate;

  // 탭에 돌아올 때마다 지금 보고 있는 뷰(월 또는 주)의 데이터만 다시 불러온다 — 예전
  // useFocusEffect(if viewMode==='month' load(...) else loadWeek(...))와 동일한 범위
  const refetchActive = useCallback(() => {
    if (viewMode === 'month') {
      monthQuery.refetch();
      monthMemosQuery.refetch();
      monthDiaryQuery.refetch();
    } else {
      weekQuery.refetch();
      weekMemosQuery.refetch();
      weekDiaryQuery.refetch();
    }
    statsQuery.refetch();
  }, [
    viewMode,
    monthQuery.refetch,
    monthMemosQuery.refetch,
    monthDiaryQuery.refetch,
    weekQuery.refetch,
    weekMemosQuery.refetch,
    weekDiaryQuery.refetch,
    statsQuery.refetch,
  ]);
  useRefetchOnFocus(refetchActive);

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

  function handleMonthChange(date: DateData) {
    setYear(date.year);
    setMonth(date.month);
  }

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

  async function handleToggleToday(routineId: string, existingCompletionId: string | null) {
    const applyUpdate = (prev: MonthData | undefined, result: Awaited<ReturnType<typeof toggleCheckCompletion>>) => {
      if (!prev) return prev;
      const completionsByRoutine = new Map(prev.completionsByRoutine);
      const routineMap = new Map(completionsByRoutine.get(routineId) ?? []);
      if (result) {
        routineMap.set(result.completed_date, result);
      } else if (existingCompletionId) {
        routineMap.delete(formatLocalDate(new Date()));
      }
      completionsByRoutine.set(routineId, routineMap);
      return { ...prev, completionsByRoutine };
    };

    try {
      const result = await toggleCheckCompletion(routineId, existingCompletionId);
      queryClient.setQueryData(['month-data', userId, year, month], (prev?: MonthData) => applyUpdate(prev, result));
      queryClient.setQueryData(['week-data', userId, weekStart], (prev?: MonthData) => applyUpdate(prev, result));
      queryClient.invalidateQueries({ queryKey: ['stats', userId] });
    } catch {
      setErrorMessage('체크 처리에 실패했어요.');
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
      setErrorMessage('메모 저장에 실패했어요.');
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
      setErrorMessage('메모 삭제에 실패했어요.');
    }
  }

  const todayStr = formatLocalDate(today);

  // useCallback으로 감싸지 않으면 CalendarScreen이 리렌더될 때마다(예: 메모 입력창에 타이핑,
  // 모달 열고 닫기 등 월간뷰와 무관한 상태 변화까지 포함) renderDay가 매번 새 함수로
  // 만들어지고, 이 새 함수가 CalendarList에 전달되면서 현재 화면에 미리 그려둔 달(최대 7개월치,
  // 빠른 스와이프 대비용)의 날짜 칸 전부가 memo 비교에서 걸려 통째로 다시 그려짐 —
  // 이게 월간뷰가 느리고 데이터 갱신될 때마다 깜빡이는 것처럼 보이던 원인이었음.
  // monthData/memosByDate/diaryDates/selectedDate/theme처럼 실제로 화면에 영향을 주는
  // 값이 바뀔 때만 함수가 새로 만들어지게 해서, 무관한 상태 변화로는 재렌더가 안 일어나게 한다
  const renderDay = useCallback(
    ({ date, state }: { date?: DateData; state?: string }) => {
      if (!date) return <View />;
      const dateStr = date.dateString;
      const monthData = monthQuery.data;
      const status = monthData && dateStr <= todayStr ? computeDayStatus(dateStr, monthData) : null;
      const memos = (monthMemosByDate[dateStr] ?? []).slice(0, 5);
      const isSelected = selectedDate === dateStr;
      const isDisabled = state === 'disabled';

      return (
        <Pressable onPress={() => setSelectedDate(dateStr)} style={styles.dayCell}>
          <View style={styles.diaryIconSlot}>
            {monthDiaryDates.has(dateStr) && <Text style={styles.diaryIcon}>📖</Text>}
          </View>
          <View
            style={[
              styles.dayNumberWrap,
              status ? { backgroundColor: STATUS_COLORS[status] } : null,
              isSelected && { borderWidth: 2, borderColor: Colors[theme].tint },
            ]}>
            <Text
              style={[
                styles.dayNumberText,
                { color: isDisabled ? (theme === 'dark' ? '#555' : '#ccc') : Colors[theme].text },
                status ? styles.dayNumberTextOnStatus : null,
                dateStr === todayStr ? { color: Colors[theme].tint, fontWeight: '700' } : null,
              ]}>
              {date.day}
            </Text>
          </View>
          {memos.length > 0 && (
            <View style={styles.memoStack}>
              {memos.map((memo) => (
                <View
                  key={memo.id}
                  style={[
                    styles.memoBar,
                    { backgroundColor: MEMO_COLORS[memo.color].bg, borderColor: MEMO_COLORS[memo.color].border },
                  ]}
                />
              ))}
            </View>
          )}
        </Pressable>
      );
    },
    [monthQuery.data, monthMemosByDate, monthDiaryDates, selectedDate, theme, todayStr]
  );

  const detail = selectedDate && activeData ? routinesForDate(selectedDate, activeData) : [];
  const selectedMemos = selectedDate ? activeMemosByDate[selectedDate] ?? [] : [];

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

  return (
    <View style={styles.container}>
      <View style={styles.viewModeTabs}>
        <Pressable
          style={[styles.viewModeTab, viewMode === 'week' && styles.viewModeTabActive]}
          onPress={() => setViewMode('week')}>
          <Text style={[styles.viewModeTabText, viewMode === 'week' && styles.viewModeTabTextActive]}>주</Text>
        </Pressable>
        <Pressable
          style={[styles.viewModeTab, viewMode === 'month' && styles.viewModeTabActive]}
          onPress={() => {
            // 월간뷰로 들어갈 때마다 예전에 보던 달이 아니라 항상 지금 달부터 보여준다
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            setYear(y);
            setMonth(m);
            setCalendarCursor(`${y}-${String(m).padStart(2, '0')}-01`);
            setViewMode('month');
          }}>
          <Text style={[styles.viewModeTabText, viewMode === 'month' && styles.viewModeTabTextActive]}>월</Text>
        </Pressable>
      </View>

      {viewMode === 'week' && (
        <View style={styles.streakBadgeRow}>
          {bestStreakEver !== null && bestStreakEver > 0 ? (
            <View style={styles.streakBadge}>
              <Text style={styles.streakBadgeText}>🔥 역대 최고 {bestStreakEver}일</Text>
            </View>
          ) : (
            <Text style={styles.streakBadgeEmptyText}>아직 최고 기록이 없어요</Text>
          )}
          {/* TEMP TEST — 통계 탭 각 루틴 카드의 "현재 스트릭"과 하나씩 값이 맞는지 확인용,
              확인 끝나면 지울 것. 최대값 하나만 보여줬더니 그 루틴이 아니면 체크해도 값이
              안 바뀐 것처럼 보여서, 통계 탭과 똑같이 루틴별로 다 나열하도록 바꿈 */}
          <Text style={styles.streakBadgeEmptyText}>
            (테스트 {new Date(statsQuery.dataUpdatedAt).toLocaleTimeString()} 기준){' '}
            {statsQuery.data?.routines.map((r) => `${r.routine.title}:${r.currentStreak}`).join(' / ') || '데이터 없음'}
          </Text>
        </View>
      )}

      {viewMode === 'month' && (
        <CalendarList
          horizontal
          pagingEnabled
          // 기본값(과거/미래 각 50개월, 총 101개월치)이 커스텀 dayComponent까지 겹쳐서 최초
          // 진입 시 로딩이 유독 오래 걸리는 원인이었음 — 실제로 쓸 일 있는 범위로 줄임
          pastScrollRange={24}
          futureScrollRange={12}
          calendarWidth={screenWidth}
          current={calendarCursor}
          onMonthChange={handleMonthChange}
          dayComponent={renderDay}
          theme={{
            calendarBackground: Colors[theme].background,
            dayTextColor: Colors[theme].text,
            monthTextColor: Colors[theme].text,
            textDisabledColor: theme === 'dark' ? '#555' : '#ccc',
            arrowColor: Colors[theme].tint,
            todayTextColor: Colors[theme].tint,
          }}
        />
      )}
      {viewMode === 'week' && (
        <View style={styles.weekContainer}>
          <View style={styles.weekHeader}>
            <Pressable onPress={() => shiftWeek(-7)} hitSlop={8}>
              <Text style={styles.weekArrow}>‹</Text>
            </Pressable>
            <Text style={styles.weekRangeText}>
              {weekStartLabel} - {weekEndLabel}
            </Text>
            <Pressable onPress={() => shiftWeek(7)} hitSlop={8}>
              <Text style={styles.weekArrow}>›</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={weekScrollRef}
            horizontal
            showsHorizontalScrollIndicator
            persistentScrollbar
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
                  <Pressable
                    key={dateStr}
                    style={[styles.weekColumn, dateStr === todayStr && styles.weekColumnToday]}
                    onPress={() => setSelectedDate(dateStr)}>
                    <View style={styles.weekColumnHeader}>
                      <View style={styles.diaryIconSlot}>
                        {weekDiaryDates.has(dateStr) && <Text style={styles.diaryIcon}>📖</Text>}
                      </View>
                      <Text style={styles.weekRowWeekday}>{WEEKDAY_LABELS[dow]}</Text>
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
                    <ScrollView style={styles.weekColumnBody} nestedScrollEnabled>
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
                  </Pressable>
                );
              })}
          </ScrollView>
        </View>
      )}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.done }]} />
          <Text style={styles.legendText}>다 완료</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.partial }]} />
          <Text style={styles.legendText}>일부 완료</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS.missed_required }]} />
          <Text style={styles.legendText}>필수 놓침</Text>
        </View>
      </View>

      <Modal
        visible={selectedDate !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedDate(null)}>
        <View style={styles.modalContainer}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.modalBackdrop]}
            onPress={() => setSelectedDate(null)}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedDate}</Text>
              <Pressable
                style={styles.diaryButton}
                onPress={() => {
                  const date = selectedDate;
                  setSelectedDate(null);
                  if (date) router.push({ pathname: '/diary-form', params: { date } });
                }}>
                <Text style={styles.diaryButtonText}>📔 일기 보기</Text>
              </Pressable>
            </View>
            {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

            <ScrollView style={styles.detailList} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionLabel}>📌 메모</Text>
              {selectedMemos.length === 0 ? (
                <Text style={styles.memoEmptyText}>메모 없음</Text>
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
                      <Pressable onPress={() => startEditMemo(memo)} hitSlop={6}>
                        <Text style={styles.memoActionText}>수정</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDeleteMemo(memo.id)} hitSlop={6}>
                        <Text style={styles.memoActionText}>삭제</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}

              <View style={styles.memoColorPicker}>
                {MEMO_COLOR_ORDER.map((c) => (
                  <Pressable
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
                  placeholder="메모 입력 (예: 내일 시험치기)"
                  placeholderTextColor="#999"
                  value={memoText}
                  onChangeText={setMemoText}
                  onSubmitEditing={handleSubmitMemo}
                />
                <Pressable style={styles.memoAddButton} onPress={handleSubmitMemo}>
                  <Text style={styles.memoAddButtonText}>{editingMemoId ? '수정완료' : '추가'}</Text>
                </Pressable>
              </View>
              {editingMemoId && (
                <Pressable
                  onPress={() => {
                    setEditingMemoId(null);
                    setMemoText('');
                    setMemoColor('yellow');
                  }}>
                  <Text style={styles.memoCancelEdit}>수정 취소</Text>
                </Pressable>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>오늘의 루틴</Text>
              {detail.length === 0 ? (
                <Text style={styles.emptyText}>이 날은 예정된 루틴이 없어요</Text>
              ) : (
                detail.map(({ routine, completion }) => {
                  const isToday = selectedDate === todayStr;
                  // 트래킹형은 숫자 기록이라 "체크 토글"(toggleCheckCompletion)을 누르면 그
                  // 숫자 기록이 지워지거나 값 없는 완료로 잘못 덮어써질 수 있어서, 오늘 날짜라도
                  // 체크형(block_type==='check')만 눌러서 토글 가능하게 한다
                  const isCheckToggleable = isToday && routine.block_type === 'check';
                  const row = (
                    <View style={styles.detailRow}>
                      <View style={[styles.detailCheckbox, completion && styles.detailCheckboxDone]}>
                        {completion && <Text style={styles.detailCheckmark}>✓</Text>}
                      </View>
                      <View style={styles.detailMain}>
                        <Text style={styles.detailTitle}>
                          {routine.title}
                          {routine.is_required && <Text style={styles.detailRequired}> *필수</Text>}
                        </Text>
                        <Text style={styles.detailTime}>{timeLabel(routine)}</Text>
                      </View>
                      {routine.block_type === 'tracking' && completion?.tracking_value !== null && (
                        <Text style={styles.detailValue}>
                          {completion?.tracking_value} {routine.tracking_unit}
                        </Text>
                      )}
                    </View>
                  );

                  return isCheckToggleable ? (
                    <Pressable
                      key={routine.id}
                      onPress={() => handleToggleToday(routine.id, completion?.id ?? null)}>
                      {row}
                    </Pressable>
                  ) : (
                    <View key={routine.id}>{row}</View>
                  );
                })
              )}
            </ScrollView>
            <Pressable style={styles.closeButton} onPress={() => setSelectedDate(null)}>
              <Text style={styles.closeButtonText}>닫기</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  viewModeTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
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
  streakBadgeRow: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
  },
  streakBadge: {
    backgroundColor: 'rgba(255, 152, 0, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  streakBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E67E00',
  },
  streakBadgeEmptyText: {
    fontSize: 11,
    opacity: 0.35,
  },
  weekContainer: {
    paddingHorizontal: 20,
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
    color: '#7C5CFC',
    fontWeight: '700',
    paddingHorizontal: 12,
  },
  weekRangeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  weekColumn: {
    width: WEEK_COLUMN_WIDTH - 6,
    minHeight: 200,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  weekColumnToday: {
    borderColor: '#7C5CFC',
    backgroundColor: 'rgba(124, 92, 252, 0.06)',
  },
  weekColumnHeader: {
    alignItems: 'center',
    marginBottom: 8,
    gap: 2,
  },
  weekColumnBody: {
    minHeight: 110,
    maxHeight: 180,
  },
  weekColumnEmpty: {
    fontSize: 11,
    opacity: 0.3,
    textAlign: 'center',
  },
  weekChip: {
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(124, 92, 252, 0.08)',
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
  },
  dayNumberText: {
    fontSize: 14,
  },
  dayNumberTextOnStatus: {
    color: '#fff',
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
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  diaryButtonText: {
    color: '#7C5CFC',
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.7,
    marginBottom: 8,
  },
  memoEmptyText: {
    fontSize: 12,
    opacity: 0.4,
    marginBottom: 8,
  },
  memoCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  memoCardText: {
    flex: 1,
    fontSize: 13,
  },
  memoCardActions: {
    flexDirection: 'row',
    gap: 10,
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
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  memoAddButton: {
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
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
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCheckboxDone: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
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
    fontSize: 14,
  },
  detailRequired: {
    fontSize: 12,
    color: '#FF6B6B',
  },
  detailTime: {
    fontSize: 12,
    opacity: 0.6,
  },
  detailValue: {
    fontSize: 13,
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#7C5CFC',
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
