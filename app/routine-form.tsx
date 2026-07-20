import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  createRoutine,
  fetchRoutineById,
  fetchSlots,
  softDeleteRoutine,
  updateRoutine,
  SLOT_LABELS,
  type BlockType,
  type RepeatType,
  type RoutineInput,
  type Slot,
} from '@/lib/routines';

const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'daily', label: '매일' },
  { value: 'weekday', label: '평일' },
  { value: 'weekend', label: '주말' },
  { value: 'custom', label: '특정 요일' },
  { value: 'once', label: '1회성' },
];

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const TRACKING_UNIT_PRESETS = ['잔', '개', '분', '페이지', 'km'];

function timeToDate(time: string | null): Date {
  const date = new Date();
  if (time) {
    const [h, m] = time.split(':').map(Number);
    date.setHours(h, m, 0, 0);
  } else {
    date.setHours(9, 0, 0, 0);
  }
  return date;
}

function dateToTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}:00`;
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function RoutineFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [title, setTitle] = useState('');
  const [blockType, setBlockType] = useState<BlockType>('check');
  const [repeatType, setRepeatType] = useState<RepeatType>('daily');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [timeMode, setTimeMode] = useState<'exact' | 'slot'>('slot');
  const [startTime, setStartTime] = useState<Date>(timeToDate('09:00'));
  const [endTime, setEndTime] = useState<Date>(timeToDate('10:00'));
  const [slotId, setSlotId] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState<Date>(new Date());
  const [isRequired, setIsRequired] = useState(false);
  const [skipHolidays, setSkipHolidays] = useState(false);
  const [trackingUnit, setTrackingUnit] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (!userId) return;
    fetchSlots(userId)
      .then((fetched) => {
        setSlots(fetched);
        setSlotId(
          (prev) => prev ?? fetched.find((s) => s.slot_type === 'morning')?.id ?? fetched[0]?.id ?? null
        );
      })
      .catch(() => setErrorMessage('슬롯 정보를 불러오지 못했어요.'));
  }, [userId]);

  useEffect(() => {
    if (!id) return;
    fetchRoutineById(id)
      .then((routine) => {
        setTitle(routine.title);
        setBlockType(routine.block_type);
        setRepeatType(routine.repeat_type);
        setRepeatDays(routine.repeat_days ?? []);
        setIsRequired(routine.is_required);
        setSkipHolidays(routine.skip_holidays);
        setTrackingUnit(routine.tracking_unit ?? '');
        if (routine.scheduled_time_start && routine.scheduled_time_end) {
          setTimeMode('exact');
          setStartTime(timeToDate(routine.scheduled_time_start));
          setEndTime(timeToDate(routine.scheduled_time_end));
        } else if (routine.slot_id) {
          setTimeMode('slot');
          setSlotId(routine.slot_id);
        }
        if (routine.scheduled_date) {
          setScheduledDate(new Date(routine.scheduled_date));
        }
      })
      .catch(() => setErrorMessage('루틴 정보를 불러오지 못했어요.'))
      .finally(() => setIsLoading(false));
  }, [id]);

  function toggleRepeatDay(day: number) {
    setRepeatDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function handleSave() {
    if (!userId) return;
    if (!title.trim()) {
      setErrorMessage('제목을 입력해주세요.');
      return;
    }
    if (repeatType === 'custom' && repeatDays.length === 0) {
      setErrorMessage('반복할 요일을 하나 이상 선택해주세요.');
      return;
    }
    if (blockType === 'tracking' && !trackingUnit.trim()) {
      setErrorMessage('트래킹 단위를 입력해주세요.');
      return;
    }
    if (timeMode === 'slot' && !slotId) {
      setErrorMessage('슬롯을 선택해주세요.');
      return;
    }

    const input: RoutineInput = {
      title: title.trim(),
      block_type: blockType,
      repeat_type: repeatType,
      repeat_days: repeatType === 'custom' ? repeatDays : null,
      scheduled_time_start: timeMode === 'exact' ? dateToTimeString(startTime) : null,
      scheduled_time_end: timeMode === 'exact' ? dateToTimeString(endTime) : null,
      scheduled_date: repeatType === 'once' ? formatLocalDate(scheduledDate) : null,
      slot_id: timeMode === 'slot' ? slotId : null,
      is_required: isRequired,
      tracking_unit: blockType === 'tracking' ? trackingUnit.trim() : null,
      skip_holidays: skipHolidays,
    };

    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (isEditing && id) {
        await updateRoutine(id, input);
      } else {
        await createRoutine(userId, input);
      }
      router.back();
    } catch (err) {
      setErrorMessage('저장에 실패했어요. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setIsSaving(true);
    try {
      await softDeleteRoutine(id);
      router.back();
    } catch (err) {
      setErrorMessage('삭제에 실패했어요.');
      setIsSaving(false);
    }
  }

  function handleTimeChange(setter: (date: Date) => void, hide: () => void) {
    return (event: DateTimePickerEvent, date?: Date) => {
      hide();
      if (event.type === 'set' && date) setter(date);
    };
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>제목</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="예: 아침 물 마시기"
      />

      <Text style={styles.label}>타입</Text>
      <View style={styles.chipRow}>
        <Chip label="체크" selected={blockType === 'check'} onPress={() => setBlockType('check')} />
        <Chip
          label="트래킹(숫자)"
          selected={blockType === 'tracking'}
          onPress={() => setBlockType('tracking')}
        />
      </View>

      {blockType === 'tracking' && (
        <>
          <Text style={styles.label}>단위</Text>
          <View style={styles.chipRow}>
            {TRACKING_UNIT_PRESETS.map((unit) => (
              <Chip
                key={unit}
                label={unit}
                selected={trackingUnit === unit}
                onPress={() => setTrackingUnit(unit)}
              />
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={trackingUnit}
            onChangeText={setTrackingUnit}
            placeholder="직접 입력 (예: 회)"
          />
        </>
      )}

      <Text style={styles.label}>반복</Text>
      <View style={styles.chipRow}>
        {REPEAT_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            selected={repeatType === opt.value}
            onPress={() => setRepeatType(opt.value)}
          />
        ))}
      </View>

      {repeatType === 'custom' && (
        <View style={styles.chipRow}>
          {DAY_LABELS.map((label, index) => (
            <Chip
              key={label}
              label={label}
              selected={repeatDays.includes(index)}
              onPress={() => toggleRepeatDay(index)}
            />
          ))}
        </View>
      )}

      {repeatType === 'once' && (
        <>
          <Pressable style={styles.timeButton} onPress={() => setShowDatePicker(true)}>
            <Text>{formatLocalDate(scheduledDate)}</Text>
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={scheduledDate}
              mode="date"
              onChange={handleTimeChange(setScheduledDate, () => setShowDatePicker(false))}
            />
          )}
        </>
      )}

      <Text style={styles.label}>시간</Text>
      <View style={styles.chipRow}>
        <Chip label="정확한 시각" selected={timeMode === 'exact'} onPress={() => setTimeMode('exact')} />
        <Chip label="슬롯" selected={timeMode === 'slot'} onPress={() => setTimeMode('slot')} />
      </View>

      {timeMode === 'exact' ? (
        <View style={styles.chipRow}>
          <Pressable style={styles.timeButton} onPress={() => setShowStartPicker(true)}>
            <Text>{dateToTimeString(startTime).slice(0, 5)}</Text>
          </Pressable>
          <Text>~</Text>
          <Pressable style={styles.timeButton} onPress={() => setShowEndPicker(true)}>
            <Text>{dateToTimeString(endTime).slice(0, 5)}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.chipRow}>
          {slots.map((slot) => (
            <Chip
              key={slot.id}
              label={SLOT_LABELS[slot.slot_type]}
              selected={slotId === slot.id}
              onPress={() => setSlotId(slot.id)}
            />
          ))}
        </View>
      )}

      {showStartPicker && (
        <DateTimePicker
          value={startTime}
          mode="time"
          onChange={handleTimeChange(setStartTime, () => setShowStartPicker(false))}
        />
      )}
      {showEndPicker && (
        <DateTimePicker
          value={endTime}
          mode="time"
          onChange={handleTimeChange(setEndTime, () => setShowEndPicker(false))}
        />
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>필수</Text>
        <Switch value={isRequired} onValueChange={setIsRequired} />
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.label}>공휴일 제외</Text>
        <Switch value={skipHolidays} onValueChange={setSkipHolidays} />
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <Pressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>{isEditing ? '수정 완료' : '추가'}</Text>
        )}
      </Pressable>

      {isEditing && (
        <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
          <Text style={styles.deleteButtonText}>삭제</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  label: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: '#7C5CFC',
    borderColor: '#7C5CFC',
  },
  chipText: {
    fontSize: 14,
  },
  chipTextSelected: {
    color: '#fff',
  },
  timeButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  error: {
    color: '#FF6B6B',
    marginTop: 16,
  },
  saveButton: {
    marginTop: 32,
    backgroundColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#FF6B6B',
  },
});
