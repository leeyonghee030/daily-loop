import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet } from 'react-native';
import { Calendar, type DateData } from 'react-native-calendars';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuth } from '@/lib/auth-context';
import {
  computeDayStatus,
  formatLocalDate,
  routinesForDate,
  fetchMonthData,
  SLOT_LABELS,
  type DayStatus,
  type MonthData,
} from '@/lib/routines';

const STATUS_COLORS: Record<DayStatus, string> = {
  done: '#4CAF50',
  partial: '#FFA726',
  missed_required: '#FF6B6B',
};

function timeLabel(routine: MonthData['routines'][number]): string {
  if (routine.scheduled_time_start && routine.scheduled_time_end) {
    return `${routine.scheduled_time_start.slice(0, 5)}-${routine.scheduled_time_end.slice(0, 5)}`;
  }
  if (routine.slots) return SLOT_LABELS[routine.slots.slot_type];
  return '';
}

export default function CalendarScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const theme = useColorScheme() ?? 'light';
  const router = useRouter();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(
    async (y: number, m: number) => {
      if (!userId) return;
      setIsLoading(true);
      try {
        const data = await fetchMonthData(userId, y, m);
        setMonthData(data);
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      load(year, month);
    }, [load, year, month])
  );

  function handleMonthChange(date: DateData) {
    setYear(date.year);
    setMonth(date.month);
  }

  const todayStr = formatLocalDate(today);
  const markedDates: Record<string, any> = {};
  if (monthData) {
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateStr > todayStr) continue;
      const status = computeDayStatus(dateStr, monthData);
      if (!status) continue;
      markedDates[dateStr] = {
        customStyles: {
          container: { backgroundColor: STATUS_COLORS[status], borderRadius: 16 },
          text: { color: '#fff' },
        },
      };
    }
  }
  if (selectedDate) {
    markedDates[selectedDate] = {
      ...(markedDates[selectedDate] ?? {}),
      customStyles: {
        container: {
          ...(markedDates[selectedDate]?.customStyles?.container ?? {}),
          borderWidth: 2,
          borderColor: Colors[theme].tint,
          borderRadius: 16,
        },
        text: markedDates[selectedDate]?.customStyles?.text ?? {},
      },
    };
  }

  const detail = selectedDate && monthData ? routinesForDate(selectedDate, monthData) : [];

  return (
    <View style={styles.container}>
      <Calendar
        current={`${year}-${String(month).padStart(2, '0')}-01`}
        onMonthChange={handleMonthChange}
        onDayPress={(date) => setSelectedDate(date.dateString)}
        markingType="custom"
        markedDates={markedDates}
        theme={{
          calendarBackground: Colors[theme].background,
          dayTextColor: Colors[theme].text,
          monthTextColor: Colors[theme].text,
          textDisabledColor: theme === 'dark' ? '#555' : '#ccc',
          arrowColor: Colors[theme].tint,
          todayTextColor: Colors[theme].tint,
        }}
      />

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
            {detail.length === 0 ? (
              <Text style={styles.emptyText}>이 날은 예정된 루틴이 없어요</Text>
            ) : (
              detail.map(({ routine, completion }) => (
                <View key={routine.id} style={styles.detailRow}>
                  <View
                    style={[
                      styles.detailCheckbox,
                      completion && styles.detailCheckboxDone,
                    ]}>
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
              ))
            )}
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
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
