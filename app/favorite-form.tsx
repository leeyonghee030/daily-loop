import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Chip } from '@/components/Chip';
import { Text, View } from '@/components/Themed';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useTranslation, type TranslationKey } from '@/lib/language';
import {
  createFavorite,
  deleteFavorite,
  fetchFavoriteById,
  updateFavorite,
  type FavoriteInput,
} from '@/lib/favorites';
import { fetchSlots, slotTimeLabel, SLOT_LABEL_KEYS, type BlockType, type Slot } from '@/lib/routines';

const TRACKING_UNIT_KEYS: TranslationKey[] = [
  'trackingUnit.cup',
  'trackingUnit.count',
  'trackingUnit.minute',
  'trackingUnit.page',
  'trackingUnit.km',
];

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
  const accent = useAccentColor();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);
  const TRACKING_UNIT_PRESETS = useMemo(() => TRACKING_UNIT_KEYS.map((key) => t(key)), [t]);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 슬롯 목록은 루틴 폼/모음집 폼 등 여러 화면이 똑같이 fetchSlots(userId)를 부르므로,
  // 쿼리 키를 통일해두면 그 화면들 중 아무 데서나 먼저 받아온 값을 그대로 재사용할 수 있다
  const slotsQuery = useQuery({
    queryKey: ['slots', userId],
    queryFn: () => fetchSlots(userId!),
    enabled: !!userId,
  });
  const slots = slotsQuery.data ?? [];

  const favoriteQuery = useQuery({
    queryKey: ['favorite', id],
    queryFn: () => fetchFavoriteById(id!),
    enabled: !!id,
  });
  const isLoading = isEditing && favoriteQuery.isLoading;

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
  // iOS 스피너가 열려있는 동안 고르고 있는 값 — routine-form.tsx와 동일한 패턴(스크롤 중엔 리렌더
  // 없이 ref로만 추적하다가 "완료"를 눌러야 실제 시작/끝 시각에 반영)
  const pickerDraftRef = useRef<Date | null>(null);
  const [pickerOpenValue, setPickerOpenValue] = useState<Date | null>(null);

  useEffect(() => {
    if (slotsQuery.isError) setErrorMessage(t('favoriteForm.errorLoadSlots'));
  }, [slotsQuery.isError]);

  useEffect(() => {
    const fetched = slotsQuery.data;
    if (!fetched) return;
    setSlotId((prev) => prev ?? fetched.find((s) => s.slot_type === 'morning')?.id ?? fetched[0]?.id ?? null);
  }, [slotsQuery.data]);

  useEffect(() => {
    const favorite = favoriteQuery.data;
    if (!favorite) return;
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
  }, [favoriteQuery.data]);

  useEffect(() => {
    if (favoriteQuery.isError) setErrorMessage(t('favoriteForm.errorLoadFavorite'));
  }, [favoriteQuery.isError]);

  function handleTimeChange(setter: (date: Date) => void, hide: () => void) {
    return (event: DateTimePickerEvent, date?: Date) => {
      hide();
      if (event.type === 'set' && date) setter(date);
    };
  }

  function openTimePicker(current: Date, show: () => void) {
    pickerDraftRef.current = current;
    setPickerOpenValue(current);
    show();
  }

  function handleSpinnerTimeChange(event: DateTimePickerEvent, date?: Date) {
    if (date) pickerDraftRef.current = date;
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
      setErrorMessage(t('favoriteForm.errorTitleRequired'));
      return;
    }
    if (blockType === 'tracking' && !trackingUnit.trim()) {
      setErrorMessage(t('favoriteForm.errorTrackingUnitRequired'));
      return;
    }
    if (timeMode === 'slot' && !slotId) {
      setErrorMessage(t('favoriteForm.errorSlotRequired'));
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
      setErrorMessage(t('favoriteForm.errorSave'));
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
      setErrorMessage(t('favoriteForm.errorDelete'));
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
      <Text style={styles.label}>{t('favoriteForm.titleLabel')}</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={t('favoriteForm.titlePlaceholder')} />

      <Text style={styles.label}>{t('favoriteForm.typeLabel')}</Text>
      <View style={styles.chipRow}>
        <Chip label={t('common.check')} selected={blockType === 'check'} onPress={() => setBlockType('check')} />
        <Chip
          label={t('common.tracking')}
          selected={blockType === 'tracking'}
          onPress={() => setBlockType('tracking')}
        />
      </View>

      {blockType === 'tracking' && (
        <>
          <Text style={styles.label}>{t('favoriteForm.unitLabel')}</Text>
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
            placeholder={t('presetForm.trackingUnitPlaceholder')}
          />
        </>
      )}

      <Text style={styles.label}>{t('favoriteForm.timeLabel')}</Text>
      <View style={styles.chipRow}>
        <Chip label={t('common.exactTime')} selected={timeMode === 'exact'} onPress={() => setTimeMode('exact')} />
        <Chip label={t('common.instantTime')} selected={timeMode === 'instant'} onPress={() => setTimeMode('instant')} />
        <Chip label={t('common.slot')} selected={timeMode === 'slot'} onPress={() => setTimeMode('slot')} />
      </View>

      {timeMode === 'exact' ? (
        <View style={styles.chipRow}>
          <AnimatedPressable
            style={styles.timeButton}
            onPress={() => openTimePicker(startTime, () => setShowStartPicker(true))}>
            <Text>{dateToTimeString(startTime).slice(0, 5)}</Text>
          </AnimatedPressable>
          <Text>~</Text>
          <AnimatedPressable
            style={styles.timeButton}
            onPress={() => openTimePicker(endTime, () => setShowEndPicker(true))}>
            <Text>{dateToTimeString(endTime).slice(0, 5)}</Text>
          </AnimatedPressable>
        </View>
      ) : timeMode === 'instant' ? (
        <View style={styles.chipRow}>
          <AnimatedPressable
            style={styles.timeButton}
            onPress={() => openTimePicker(startTime, () => setShowStartPicker(true))}>
            <Text>{dateToTimeString(startTime).slice(0, 5)}</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <View style={styles.chipRow}>
          {slots.map((slot) => (
            <Chip
              key={slot.id}
              label={`${t(SLOT_LABEL_KEYS[slot.slot_type])} ${slotTimeLabel(slot)}`}
              selected={slotId === slot.id}
              onPress={() => setSlotId(slot.id)}
            />
          ))}
        </View>
      )}

      {/* 안드로이드는 시계가 OS 다이얼로그로 뜨고 확인/취소를 누르면 다이얼로그 스스로 닫히므로,
          그때마다 우리도 showXPicker를 꺼줘야 함. iOS는 계속 스크롤 가능한 스피너라서 "완료" 버튼을
          직접 눌러야 닫히게 함 — routine-form.tsx와 동일한 패턴 */}
      {showStartPicker &&
        (Platform.OS === 'android' ? (
          <DateTimePicker
            value={startTime}
            mode="time"
            display="spinner"
            minuteInterval={15}
            onChange={handleTimeChange(setStartTime, () => setShowStartPicker(false))}
          />
        ) : (
          <View style={styles.spinnerBox}>
            <DateTimePicker
              value={pickerOpenValue ?? startTime}
              mode="time"
              display="spinner"
              minuteInterval={15}
              onChange={handleSpinnerTimeChange}
            />
            <AnimatedPressable
              style={styles.spinnerDoneButton}
              onPress={() => {
                const picked = pickerDraftRef.current;
                if (picked) setStartTime(picked);
                pickerDraftRef.current = null;
                setPickerOpenValue(null);
                setShowStartPicker(false);
              }}>
              <Text style={styles.spinnerDoneText}>{t('common.done')}</Text>
            </AnimatedPressable>
          </View>
        ))}
      {showEndPicker &&
        (Platform.OS === 'android' ? (
          <DateTimePicker
            value={endTime}
            mode="time"
            display="spinner"
            minuteInterval={15}
            onChange={handleTimeChange(applyEndTime, () => setShowEndPicker(false))}
          />
        ) : (
          <View style={styles.spinnerBox}>
            <DateTimePicker
              value={pickerOpenValue ?? endTime}
              mode="time"
              display="spinner"
              minuteInterval={15}
              onChange={handleSpinnerTimeChange}
            />
            <AnimatedPressable
              style={styles.spinnerDoneButton}
              onPress={() => {
                const picked = pickerDraftRef.current;
                if (picked) applyEndTime(picked);
                pickerDraftRef.current = null;
                setPickerOpenValue(null);
                setShowEndPicker(false);
              }}>
              <Text style={styles.spinnerDoneText}>{t('common.done')}</Text>
            </AnimatedPressable>
          </View>
        ))}

      <View style={styles.switchRow}>
        <Text style={styles.label}>{t('common.required')}</Text>
        <Switch value={isRequired} onValueChange={setIsRequired} />
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <AnimatedPressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>{isEditing ? t('favoriteForm.saveEdit') : t('favoriteForm.addToFavorites')}</Text>
        )}
      </AnimatedPressable>

      {isEditing && (
        <AnimatedPressable style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
          <Text style={styles.deleteButtonText}>{t('myRoutines.delete')}</Text>
        </AnimatedPressable>
      )}
    </ScrollView>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
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
    borderColor: border,
    borderRadius: cardRadius,
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
    borderColor: border,
    borderRadius: cardRadius,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  spinnerBox: {
    alignItems: 'center',
  },
  spinnerDoneButton: {
    alignSelf: 'center',
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  spinnerDoneText: {
    color: '#fff',
    fontWeight: '600',
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
    backgroundColor: accent,
    borderRadius: cardRadius,
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
}
