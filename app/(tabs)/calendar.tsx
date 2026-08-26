import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
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
import {
  computeDayStatus,
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

function timeLabel(routine: MonthData['routines'][number]): string {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '';
}

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


export default function CalendarScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const theme = useColorScheme() ?? 'light';
  const router = useRouter();

  const today = new Date();
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [weekStart, setWeekStart] = useState(() => formatLocalDate(sundayOf(today)));
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [weekData, setWeekData] = useState<MonthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [memosByDate, setMemosByDate] = useState<Record<string, DateMemo[]>>({});
  const [diaryDates, setDiaryDates] = useState<Set<string>>(new Set());
  const [memoText, setMemoText] = useState('');
  const [memoColor, setMemoColor] = useState<MemoColor>('yellow');
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);

  const activeData = viewMode === 'week' ? weekData : monthData;
  const hasLoadedMonthRef = useRef(false);
  const hasLoadedWeekRef = useRef(false);

  useEffect(() => {
    setMemoText('');
    setMemoColor('yellow');
    setEditingMemoId(null);
  }, [selectedDate]);

  // 월/주 이동할 때마다 전체 화면 스피너가 깜빡이지 않도록, 처음 한 번만 로딩 표시를 켠다
  const load = useCallback(
    async (y: number, m: number) => {
      if (!userId) return;
      if (!hasLoadedMonthRef.current) setIsLoading(true);
      try {
        const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
        const [data, memos, diaryList] = await Promise.all([
          fetchMonthData(userId, y, m),
          fetchMemosInRange(userId, monthStart, monthEnd),
          fetchDiaryDatesInRange(userId, monthStart, monthEnd),
        ]);
        setMonthData(data);
        setMemosByDate((prev) => ({ ...prev, ...groupMemosByDate(memos) }));
        setDiaryDates((prev) => new Set([...prev, ...diaryList]));
        hasLoadedMonthRef.current = true;
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  const loadWeek = useCallback(
    async (start: string) => {
      if (!userId) return;
      if (!hasLoadedWeekRef.current) setIsLoading(true);
      try {
        const endDate = new Date(`${start}T00:00:00`);
        endDate.setDate(endDate.getDate() + 6);
        const endDateStr = formatLocalDate(endDate);
        const [data, memos, diaryList] = await Promise.all([
          fetchWeekData(userId, start),
          fetchMemosInRange(userId, start, endDateStr),
          fetchDiaryDatesInRange(userId, start, endDateStr),
        ]);
        setWeekData(data);
        setMemosByDate((prev) => ({ ...prev, ...groupMemosByDate(memos) }));
        setDiaryDates((prev) => new Set([...prev, ...diaryList]));
        hasLoadedWeekRef.current = true;
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      if (viewMode === 'month') load(year, month);
      else loadWeek(weekStart);
    }, [viewMode, load, year, month, loadWeek, weekStart])
  );

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

  useEffect(() => {
    weekScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [weekStart]);

  async function handleToggleToday(routineId: string, existingCompletionId: string | null) {
    const applyUpdate = (prev: MonthData | null, result: Awaited<ReturnType<typeof toggleCheckCompletion>>) => {
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
      setMonthData((prev) => applyUpdate(prev, result));
      setWeekData((prev) => applyUpdate(prev, result));
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
        setMemosByDate((prev) => ({
          ...prev,
          [selectedDate]: (prev[selectedDate] ?? []).map((m) => (m.id === updated.id ? updated : m)),
        }));
      } else {
        const created = await createMemo(userId, selectedDate, text, memoColor);
        setMemosByDate((prev) => ({
          ...prev,
          [selectedDate]: [...(prev[selectedDate] ?? []), created],
        }));
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
      setMemosByDate((prev) => ({
        ...prev,
        [selectedDate]: (prev[selectedDate] ?? []).filter((m) => m.id !== memoId),
      }));
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

  function renderDay({ date, state }: { date?: DateData; state?: string }) {
    if (!date) return <View />;
    const dateStr = date.dateString;
    const status = monthData && dateStr <= todayStr ? computeDayStatus(dateStr, monthData) : null;
    const memos = (memosByDate[dateStr] ?? []).slice(0, 5);
    const isSelected = selectedDate === dateStr;
    const isDisabled = state === 'disabled';

    return (
      <Pressable onPress={() => setSelectedDate(dateStr)} style={styles.dayCell}>
        <View style={styles.diaryIconSlot}>
          {diaryDates.has(dateStr) && <Text style={styles.diaryIcon}>📖</Text>}
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
  }

  const detail = selectedDate && activeData ? routinesForDate(selectedDate, activeData) : [];
  const selectedMemos = selectedDate ? memosByDate[selectedDate] ?? [] : [];

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
          style={[styles.viewModeTab, viewMode === 'month' && styles.viewModeTabActive]}
          onPress={() => setViewMode('month')}>
          <Text style={[styles.viewModeTabText, viewMode === 'month' && styles.viewModeTabTextActive]}>월</Text>
        </Pressable>
        <Pressable
          style={[styles.viewModeTab, viewMode === 'week' && styles.viewModeTabActive]}
          onPress={() => setViewMode('week')}>
          <Text style={[styles.viewModeTabText, viewMode === 'week' && styles.viewModeTabTextActive]}>주</Text>
        </Pressable>
      </View>

      {viewMode === 'month' ? (
        <CalendarList
          horizontal
          pagingEnabled
          calendarWidth={screenWidth}
          current={`${year}-${String(month).padStart(2, '0')}-01`}
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
      ) : (
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

          <ScrollView ref={weekScrollRef} horizontal showsHorizontalScrollIndicator persistentScrollbar>
            {weekData &&
              weekDates.map((dateStr, index) => {
                const isFuture = dateStr > todayStr;
                const status = !isFuture ? computeDayStatus(dateStr, weekData) : null;
                const dayNum = Number(dateStr.slice(8, 10));
                const scheduled = isFuture ? [] : routinesForDate(dateStr, weekData);
                return (
                  <Pressable
                    key={dateStr}
                    style={[styles.weekColumn, dateStr === todayStr && styles.weekColumnToday]}
                    onPress={() => setSelectedDate(dateStr)}>
                    <View style={styles.weekColumnHeader}>
                      <View style={styles.diaryIconSlot}>
                        {diaryDates.has(dateStr) && <Text style={styles.diaryIcon}>📖</Text>}
                      </View>
                      <Text style={styles.weekRowWeekday}>{WEEKDAY_LABELS[index]}</Text>
                      <Text style={styles.weekRowDay}>{dayNum}</Text>
                      {status && <View style={[styles.weekStatusDot, { backgroundColor: STATUS_COLORS[status] }]} />}
                      {(memosByDate[dateStr] ?? []).length > 0 && (
                        <View style={styles.weekMemoRow}>
                          {(memosByDate[dateStr] ?? []).slice(0, 5).map((memo) => (
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

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}

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
                      {!isToday && routine.block_type === 'tracking' && completion?.tracking_value !== null && (
                        <Text style={styles.detailValue}>
                          {completion?.tracking_value} {routine.tracking_unit}
                        </Text>
                      )}
                    </View>
                  );

                  return isToday ? (
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
    width: 80,
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
    maxHeight: 130,
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
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
