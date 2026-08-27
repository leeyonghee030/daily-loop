import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { Chip } from '@/components/Chip';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  createFavorite,
  deleteFavorite,
  fetchFavoriteById,
  updateFavorite,
  type FavoriteInput,
} from '@/lib/favorites';
import { fetchSlots, SLOT_LABELS, type BlockType, type Slot } from '@/lib/routines';

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

export default function FavoriteFormScreen() {
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
  const [trackingUnit, setTrackingUnit] = useState('');
  const [timeMode, setTimeMode] = useState<'exact' | 'slot' | 'instant'>('slot');
  const [startTime, setStartTime] = useState<Date>(timeToDate('09:00'));
  const [endTime, setEndTime] = useState<Date>(timeToDate('10:00'));
  const [slotId, setSlotId] = useState<string | null>(null);
  const [isRequired, setIsRequired] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  useEffect(() => {
    if (!userId) return;
    fetchSlots(userId)
      .then((fetched) => {
        setSlots(fetched);
        setSlotId((prev) => prev ?? fetched.find((s) => s.slot_type === 'morning')?.id ?? fetched[0]?.id ?? null);
      })
      .catch(() => setErrorMessage('슬롯 정보를 불러오지 못했어요.'));
  }, [userId]);

  useEffect(() => {
    if (!id) return;
    fetchFavoriteById(id)
      .then((favorite) => {
        setTitle(favorite.title);
        setBlockType(favorite.block_type);
        setTrackingUnit(favorite.tracking_unit ?? '');
        setIsRequired(favorite.is_required);
        if (favorite.is_instant && favorite.scheduled_time_start) {
          setTimeMode('instant');
          setStartTime(timeToDate(favorite.scheduled_time_start));
        } else if (favorite.scheduled_time_start && favorite.scheduled_time_end) {
          setTimeMode('exact');
          setStartTime(timeToDate(favorite.scheduled_time_start));
          setEndTime(timeToDate(favorite.scheduled_time_end));
        } else if (favorite.slot_id) {
          setTimeMode('slot');
          setSlotId(favorite.slot_id);
        }
      })
      .catch(() => setErrorMessage('즐겨찾기 정보를 불러오지 못했어요.'))
      .finally(() => setIsLoading(false));
  }, [id]);

  function handleTimeChange(setter: (date: Date) => void, hide: () => void) {
    return (event: DateTimePickerEvent, date?: Date) => {
      hide();
      if (event.type === 'set' && date) setter(date);
    };
  }

  // 끝이 시작보다 같거나 이르면 무시한다 — 안 그러면 자정을 넘겨 이어지는 걸로 잘못 계산돼서
  // 버그처럼 보임. 시계로는 24:00을 고를 수 없어 자정에 끝내려면 00:00을 골라야 하니, 그 경우만 예외로 허용
  function applyEndTime(newEnd: Date) {
    const isMidnight = newEnd.getHours() === 0 && newEnd.getMinutes() === 0;
    if (!isMidnight && newEnd.getTime() <= startTime.getTime()) return;
    setEndTime(newEnd);
  }

  async function handleSave() {
    if (!userId) return;
    if (!title.trim()) {
      setErrorMessage('제목을 입력해주세요.');
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

    const input: FavoriteInput = {
      title: title.trim(),
      block_type: blockType,
      scheduled_time_start: timeMode !== 'slot' ? dateToTimeString(startTime) : null,
      scheduled_time_end:
        timeMode === 'exact' ? dateToTimeString(endTime) : timeMode === 'instant' ? dateToTimeString(startTime) : null,
      is_instant: timeMode === 'instant',
      slot_id: timeMode === 'slot' ? slotId : null,
      is_required: isRequired,
      tracking_unit: blockType === 'tracking' ? trackingUnit.trim() : null,
    };

    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (isEditing && id) {
        await updateFavorite(id, input);
      } else {
        await createFavorite(userId, input);
      }
      router.back();
    } catch (err) {
      setErrorMessage('저장에 실패했어요.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setIsSaving(true);
    try {
      await deleteFavorite(id);
      router.back();
    } catch (err) {
      setErrorMessage('삭제에 실패했어요.');
      setIsSaving(false);
    }
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
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="예: 스트레칭" />

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

      <Text style={styles.label}>시간</Text>
      <View style={styles.chipRow}>
        <Chip label="정확한 시간" selected={timeMode === 'exact'} onPress={() => setTimeMode('exact')} />
        <Chip label="시간 체크" selected={timeMode === 'instant'} onPress={() => setTimeMode('instant')} />
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
      ) : timeMode === 'instant' ? (
        <View style={styles.chipRow}>
          <Pressable style={styles.timeButton} onPress={() => setShowStartPicker(true)}>
            <Text>{dateToTimeString(startTime).slice(0, 5)}</Text>
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
          minuteInterval={15}
          onChange={handleTimeChange(setStartTime, () => setShowStartPicker(false))}
        />
      )}
      {showEndPicker && (
        <DateTimePicker
          value={endTime}
          mode="time"
          minuteInterval={15}
          onChange={handleTimeChange(applyEndTime, () => setShowEndPicker(false))}
        />
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>필수</Text>
        <Switch value={isRequired} onValueChange={setIsRequired} />
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <Pressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>{isEditing ? '수정 완료' : '즐겨찾기에 추가'}</Text>
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
