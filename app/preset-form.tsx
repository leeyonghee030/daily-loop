import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { Chip } from '@/components/Chip';
import { FavoritePicker } from '@/components/FavoritePicker';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { fetchFavorites, type Favorite } from '@/lib/favorites';
import {
  applyNewPresetItems,
  applyPreset,
  deletePreset,
  fetchPresetWithItems,
  removePresetItemRoutines,
  savePreset,
  type PresetItemInput,
} from '@/lib/presets';
import { fetchSlots, SLOT_LABELS, type BlockType, type RepeatType, type Slot } from '@/lib/routines';

const REPEAT_OPTIONS: { value: Exclude<RepeatType, 'once'>; label: string }[] = [
  { value: 'daily', label: '매일' },
  { value: 'weekday', label: '평일' },
  { value: 'weekend', label: '주말' },
  { value: 'custom', label: '특정 요일' },
];

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const TRACKING_UNIT_PRESETS = ['잔', '개', '분', '페이지', 'km'];

// isNew: 이번에 편집하는 동안 새로 추가된 항목인지 — 기존 모음집을 수정할 때, 이미 적용된
// 항목은 그대로 두고 새로 추가된 항목만 실제 루틴으로 반영하기 위해 구분해둔다
type ItemDraft = PresetItemInput & { key: string; collapsed: boolean; isNew: boolean };

function itemSummary(item: ItemDraft, slots: Slot[]): string {
  const timePart = item.is_instant
    ? item.scheduled_time_start?.slice(0, 5)
    : item.scheduled_time_start
      ? `${item.scheduled_time_start.slice(0, 5)}-${(item.scheduled_time_end ?? '').slice(0, 5)}`
      : SLOT_LABELS[slots.find((s) => s.id === item.slot_id)?.slot_type ?? 'morning'];
  const unitPart = item.block_type === 'tracking' ? ` · ${item.tracking_unit}` : '';
  const requiredPart = item.is_required ? ' · 필수' : '';
  return `${timePart}${unitPart}${requiredPart}`;
}

function makeKey(): string {
  return Math.random().toString(36).slice(2);
}

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

export default function PresetFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [name, setName] = useState('');
  const [repeatType, setRepeatType] = useState<Exclude<RepeatType, 'once'>>('weekday');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [skipHolidays, setSkipHolidays] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([]);
  // 이번 편집 중 지운, 원래 있던(isNew가 아닌) 항목들 — 저장 시 그만큼 실제 루틴도 같이 지운다
  const [removedOriginalItems, setRemovedOriginalItems] = useState<PresetItemInput[]>([]);
  // key별 "DB에서 막 불러왔을 때"의 원본 내용 — 항목을 지우기 전에 필드를 먼저 고쳤을 수도 있어서,
  // 실제 루틴과 매칭할 땐 화면에 보이는 지금 값이 아니라 이 원본 값을 써야 한다
  const originalItemsByKey = useRef<Record<string, PresetItemInput>>({});
  const [activeTimePicker, setActiveTimePicker] = useState<{
    index: number;
    field: 'start' | 'end';
  } | null>(null);
  // iOS 스피너가 열려있는 동안 고르고 있는 값 — ref라 값이 바뀌어도 리렌더를 안 일으킨다.
  // state로 관리해서 스피너의 value prop에 매 스크롤마다 다시 흘려보내면(제어 컴포넌트 재렌더)
  // 라이브러리가 내부적으로 휠 위치를 다시 계산하면서 분만 움직였는데도 시 휠까지 밀리는 문제가
  // 있어서, 스피너를 여는 순간의 값으로 value를 고정해두고(pickerOpenValue) 그동안 고른 값은
  // 화면엔 반영하지 않다가 "완료"를 눌러야만 실제 항목에 반영한다
  const pickerDraftRef = useRef<Date | null>(null);
  const [pickerOpenValue, setPickerOpenValue] = useState<Date | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [showFavoritePicker, setShowFavoritePicker] = useState(false);

  useEffect(() => {
    if (!userId) return;
    fetchSlots(userId)
      .then(setSlots)
      .catch(() => setErrorMessage('슬롯 정보를 불러오지 못했어요.'));
    fetchFavorites(userId)
      .then(setFavorites)
      .catch(() => setErrorMessage('즐겨찾기를 불러오지 못했어요.'));
  }, [userId]);

  useEffect(() => {
    if (!id) return;
    fetchPresetWithItems(id)
      .then(({ preset, items: fetchedItems }) => {
        setName(preset.name);
        setRepeatType(preset.repeat_type as Exclude<RepeatType, 'once'>);
        setRepeatDays(preset.repeat_days ?? []);
        setSkipHolidays(preset.skip_holidays);
        const loadedItems = fetchedItems.map((item) => ({
          key: makeKey(),
          title: item.title,
          block_type: item.block_type,
          scheduled_time_start: item.scheduled_time_start,
          scheduled_time_end: item.scheduled_time_end,
          is_instant: item.is_instant,
          slot_id: item.slot_id,
          is_required: item.is_required,
          tracking_unit: item.tracking_unit,
          collapsed: true,
          isNew: false,
        }));
        setItems(loadedItems);
        originalItemsByKey.current = Object.fromEntries(
          loadedItems.map(({ key, collapsed, isNew, ...rest }) => [key, rest])
        );
      })
      .catch(() => setErrorMessage('모음집 정보를 불러오지 못했어요.'))
      .finally(() => setIsLoading(false));
  }, [id]);

  function toggleRepeatDay(day: number) {
    setRepeatDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        key: makeKey(),
        title: '',
        block_type: 'check',
        scheduled_time_start: null,
        scheduled_time_end: null,
        is_instant: false,
        slot_id: slots.find((s) => s.slot_type === 'morning')?.id ?? slots[0]?.id ?? null,
        is_required: false,
        tracking_unit: null,
        collapsed: false,
        isNew: true,
      },
    ]);
  }

  function addItemFromFavorite(favorite: Favorite) {
    setItems((prev) => [
      ...prev,
      {
        key: makeKey(),
        title: favorite.title,
        block_type: favorite.block_type,
        scheduled_time_start: favorite.scheduled_time_start,
        scheduled_time_end: favorite.scheduled_time_end,
        is_instant: favorite.is_instant,
        slot_id: favorite.slot_id,
        is_required: favorite.is_required,
        tracking_unit: favorite.tracking_unit,
        collapsed: true,
        isNew: true,
      },
    ]);
    setShowFavoritePicker(false);
  }

  function removeItem(index: number) {
    const removed = items[index];
    if (!removed.isNew) {
      // 지우기 전에 필드를 먼저 고쳤을 수 있으니, 화면에 보이는 지금 값이 아니라
      // DB에서 막 불러왔을 때의 원본 값으로 실제 루틴과 매칭한다
      const original = originalItemsByKey.current[removed.key];
      if (original) {
        setRemovedOriginalItems((prev) => [...prev, original]);
      }
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function collapseItem(index: number) {
    if (!items[index].title.trim()) return;
    updateItem(index, { collapsed: true });
  }

  function setItemTimeMode(index: number, mode: 'exact' | 'slot' | 'instant') {
    if (mode === 'exact') {
      updateItem(index, {
        slot_id: null,
        is_instant: false,
        scheduled_time_start: dateToTimeString(timeToDate('09:00')),
        scheduled_time_end: dateToTimeString(timeToDate('10:00')),
      });
    } else if (mode === 'instant') {
      const time = dateToTimeString(timeToDate('09:00'));
      updateItem(index, {
        slot_id: null,
        is_instant: true,
        scheduled_time_start: time,
        scheduled_time_end: time,
      });
    } else {
      updateItem(index, {
        scheduled_time_start: null,
        scheduled_time_end: null,
        is_instant: false,
        slot_id: slots.find((s) => s.slot_type === 'morning')?.id ?? slots[0]?.id ?? null,
      });
    }
  }

  // 끝이 시작보다 같거나 이르면 무시한다 — 안 그러면 자정을 넘겨 이어지는 걸로 잘못 계산돼서
  // 버그처럼 보임. 시계로는 24:00을 고를 수 없어 자정에 끝내려면 00:00을 골라야 하니, 그 경우만 예외로 허용
  function applyPickedTime(picker: { index: number; field: 'start' | 'end' }, date: Date) {
    const time = dateToTimeString(date);
    const item = items[picker.index];
    if (item.is_instant) {
      updateItem(picker.index, { scheduled_time_start: time, scheduled_time_end: time });
      return;
    }
    if (picker.field === 'end') {
      const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
      if (!isMidnight && item.scheduled_time_start && time <= item.scheduled_time_start) return;
      updateItem(picker.index, { scheduled_time_end: time });
      return;
    }
    updateItem(picker.index, { scheduled_time_start: time });
  }

  // 안드로이드는 시계가 OS 다이얼로그로 뜨고 확인/취소를 누르면 다이얼로그 스스로 닫히므로,
  // 그때마다 우리도 activeTimePicker를 꺼줘야 함. iOS는 다이얼로그 없이 계속 스크롤 가능한
  // 스피너라서, "완료" 버튼을 직접 눌러야 닫히게 함(routine-form.tsx와 동일한 방식)
  function handleTimeChange(event: DateTimePickerEvent, date?: Date) {
    const picker = activeTimePicker;
    setActiveTimePicker(null);
    if (!picker || event.type !== 'set' || !date) return;
    applyPickedTime(picker, date);
  }

  // iOS 스피너는 스크롤할 때마다 계속 값이 바뀌므로, 항목에 바로 반영하지 않고 ref에만 적어둔다
  // (state로 하면 스피너의 value prop에 다시 흘러들어가 재렌더되면서 분만 움직였는데도 시 휠까지
  // 밀리는 문제가 있었음) — "완료"를 눌러야 실제로 반영됨(routine-form.tsx와 동일한 방식)
  function handleSpinnerTimeChange(event: DateTimePickerEvent, date?: Date) {
    if (date) pickerDraftRef.current = date;
  }

  function openItemTimePicker(current: Date, picker: { index: number; field: 'start' | 'end' }) {
    pickerDraftRef.current = current;
    setPickerOpenValue(current);
    setActiveTimePicker(picker);
  }

  async function handleSave() {
    if (!userId) return;
    if (!name.trim()) {
      setErrorMessage('모음집 이름을 입력해주세요.');
      return;
    }
    if (repeatType === 'custom' && repeatDays.length === 0) {
      setErrorMessage('반복할 요일을 하나 이상 선택해주세요.');
      return;
    }
    if (items.length === 0) {
      setErrorMessage('항목을 하나 이상 추가해주세요.');
      return;
    }
    for (const item of items) {
      if (!item.title.trim()) {
        setErrorMessage('모든 항목의 제목을 입력해주세요.');
        return;
      }
      if (item.block_type === 'tracking' && !item.tracking_unit?.trim()) {
        setErrorMessage('트래킹 항목은 단위를 입력해주세요.');
        return;
      }
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const itemInputs = items.map(({ key, collapsed, isNew, ...rest }) => ({
        ...rest,
        title: rest.title.trim(),
      }));
      const presetId = await savePreset(
        userId,
        id ?? null,
        {
          name: name.trim(),
          repeat_type: repeatType,
          repeat_days: repeatType === 'custom' ? repeatDays : null,
          skip_holidays: skipHolidays,
        },
        itemInputs
      );
      // 새로 만든 모음집은 저장과 동시에 오늘 목록에도 바로 적용한다 —
      // "만들었는데 내 루틴에 안 보인다"는 혼란을 줄이기 위함. 원치 않는 루틴은 "일시정지"로 끄면 됨.
      // 기존 모음집 수정은 이미 적용된 항목은 건드리지 않되, 이번에 새로 추가한 항목만 골라서
      // 바로 적용한다 — 안 그러면 새 항목이 템플릿에만 남고 실제 루틴으로는 안 생겨서
      // "내 루틴"에서 안 보이거나(특히 이름이 같은 항목을 중복으로 추가한 경우) 헷갈렸음
      if (!isEditing) {
        const count = await applyPreset(userId, presetId);
        Alert.alert(
          '모음집을 만들었어요',
          `루틴 ${count}개가 오늘 목록에 바로 추가됐어요. 원치 않는 항목은 "내 루틴"에서 일시정지할 수 있어요.`,
          [{ text: '확인', onPress: () => router.back() }]
        );
      } else {
        const newItemInputs = items
          .map((item, index) => (item.isNew ? itemInputs[index] : null))
          .filter((input): input is PresetItemInput => input !== null);
        // 삭제를 먼저 하고 추가를 나중에 해야 함 — 동시에 하면, 방금 새로 만든 루틴이 지운
        // 항목과 우연히 같은 내용(제목/시간 등)일 때 삭제 쪽이 기존 것 대신 방금 만든 걸
        // 잘못 매칭해서 지울 수 있음
        const removedCount =
          removedOriginalItems.length > 0
            ? await removePresetItemRoutines(presetId, removedOriginalItems)
            : 0;
        const addedCount =
          newItemInputs.length > 0 ? await applyNewPresetItems(userId, presetId, newItemInputs) : 0;
        setRemovedOriginalItems([]);
        if (addedCount > 0 || removedCount > 0) {
          const parts: string[] = [];
          if (addedCount > 0) parts.push(`추가 ${addedCount}개`);
          if (removedCount > 0) parts.push(`삭제 ${removedCount}개`);
          Alert.alert(
            '오늘 목록에 반영했어요',
            `루틴 ${parts.join(' · ')}. 원치 않는 항목은 "내 루틴"에서 일시정지할 수 있어요.`,
            [{ text: '확인', onPress: () => router.back() }]
          );
        } else {
          router.back();
        }
      }
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
      await deletePreset(id);
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
      <Text style={styles.label}>모음집 이름</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="예: 평일 일정" />

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

      <View style={styles.switchRow}>
        <Text style={styles.label}>공휴일 제외</Text>
        <Switch value={skipHolidays} onValueChange={setSkipHolidays} />
      </View>

      <Text style={styles.sectionLabel}>항목</Text>

      {items.map((item, index) => {
        const timeMode = item.is_instant ? 'instant' : item.scheduled_time_start ? 'exact' : 'slot';

        if (item.collapsed) {
          return (
            <Pressable
              key={item.key}
              style={styles.collapsedItem}
              onPress={() => updateItem(index, { collapsed: false })}>
              <View style={styles.collapsedItemInfo}>
                <Text style={styles.collapsedItemTitle}>{item.title}</Text>
                <Text style={styles.collapsedItemMeta}>{itemSummary(item, slots)}</Text>
              </View>
              <Pressable onPress={() => removeItem(index)}>
                <Text style={styles.removeItemText}>삭제</Text>
              </Pressable>
            </Pressable>
          );
        }

        return (
          <View key={item.key} style={styles.itemCard}>
            <View style={styles.itemHeaderRow}>
              <TextInput
                style={styles.itemTitleInput}
                value={item.title}
                onChangeText={(text) => updateItem(index, { title: text })}
                placeholder="루틴 제목"
              />
              <Pressable onPress={() => removeItem(index)}>
                <Text style={styles.removeItemText}>삭제</Text>
              </Pressable>
            </View>

            <View style={styles.chipRow}>
              <Chip
                label="체크"
                selected={item.block_type === 'check'}
                onPress={() => updateItem(index, { block_type: 'check' as BlockType, tracking_unit: null })}
              />
              <Chip
                label="트래킹(숫자)"
                selected={item.block_type === 'tracking'}
                onPress={() => updateItem(index, { block_type: 'tracking' as BlockType })}
              />
            </View>

            {item.block_type === 'tracking' && (
              <>
                <View style={styles.chipRow}>
                  {TRACKING_UNIT_PRESETS.map((unit) => (
                    <Chip
                      key={unit}
                      label={unit}
                      selected={item.tracking_unit === unit}
                      onPress={() => updateItem(index, { tracking_unit: unit })}
                    />
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  value={item.tracking_unit ?? ''}
                  onChangeText={(text) => updateItem(index, { tracking_unit: text })}
                  placeholder="직접 입력 (예: 회)"
                />
              </>
            )}

            <View style={styles.chipRow}>
              <Chip label="정확한 시간" selected={timeMode === 'exact'} onPress={() => setItemTimeMode(index, 'exact')} />
              <Chip label="시간 체크" selected={timeMode === 'instant'} onPress={() => setItemTimeMode(index, 'instant')} />
              <Chip label="슬롯" selected={timeMode === 'slot'} onPress={() => setItemTimeMode(index, 'slot')} />
            </View>

            {timeMode === 'exact' ? (
              <View style={styles.chipRow}>
                <Pressable
                  style={styles.timeButton}
                  onPress={() =>
                    openItemTimePicker(timeToDate(item.scheduled_time_start), { index, field: 'start' })
                  }>
                  <Text>{(item.scheduled_time_start ?? '09:00:00').slice(0, 5)}</Text>
                </Pressable>
                <Text>~</Text>
                <Pressable
                  style={styles.timeButton}
                  onPress={() =>
                    openItemTimePicker(timeToDate(item.scheduled_time_end), { index, field: 'end' })
                  }>
                  <Text>{(item.scheduled_time_end ?? '10:00:00').slice(0, 5)}</Text>
                </Pressable>
              </View>
            ) : timeMode === 'instant' ? (
              <View style={styles.chipRow}>
                <Pressable
                  style={styles.timeButton}
                  onPress={() => {
                    openItemTimePicker(timeToDate(item.scheduled_time_start), { index, field: 'start' });
                  }}>
                  <Text>{(item.scheduled_time_start ?? '09:00:00').slice(0, 5)}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.chipRow}>
                {slots.map((slot) => (
                  <Chip
                    key={slot.id}
                    label={SLOT_LABELS[slot.slot_type]}
                    selected={item.slot_id === slot.id}
                    onPress={() => updateItem(index, { slot_id: slot.id })}
                  />
                ))}
              </View>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.label}>필수</Text>
              <Switch
                value={item.is_required}
                onValueChange={(value) => updateItem(index, { is_required: value })}
              />
            </View>

            <Pressable style={styles.itemDoneButton} onPress={() => collapseItem(index)}>
              <Text style={styles.itemDoneButtonText}>완료</Text>
            </Pressable>
          </View>
        );
      })}

      {activeTimePicker &&
        (Platform.OS === 'android' ? (
          <DateTimePicker
            value={timeToDate(
              activeTimePicker.field === 'start'
                ? items[activeTimePicker.index].scheduled_time_start
                : items[activeTimePicker.index].scheduled_time_end
            )}
            mode="time"
            display="spinner"
            minuteInterval={15}
            onChange={handleTimeChange}
          />
        ) : (
          <View style={styles.spinnerBox}>
            <DateTimePicker
              value={
                pickerOpenValue ??
                timeToDate(
                  activeTimePicker.field === 'start'
                    ? items[activeTimePicker.index].scheduled_time_start
                    : items[activeTimePicker.index].scheduled_time_end
                )
              }
              mode="time"
              display="spinner"
              minuteInterval={15}
              onChange={handleSpinnerTimeChange}
            />
            <Pressable
              style={styles.spinnerDoneButton}
              onPress={() => {
                const picked = pickerDraftRef.current;
                if (picked) applyPickedTime(activeTimePicker, picked);
                pickerDraftRef.current = null;
                setPickerOpenValue(null);
                setActiveTimePicker(null);
              }}>
              <Text style={styles.spinnerDoneText}>완료</Text>
            </Pressable>
          </View>
        ))}

      <View style={styles.addItemRow}>
        <Pressable style={[styles.addItemButton, styles.addItemButtonFlex]} onPress={addItem}>
          <Text style={styles.addItemButtonText}>+ 항목 추가</Text>
        </Pressable>
        <Pressable
          style={[styles.addItemButton, styles.addItemButtonFlex]}
          onPress={() => setShowFavoritePicker(true)}>
          <Text style={styles.addItemButtonText}>⭐ 즐겨찾기에서 추가</Text>
        </Pressable>
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <Pressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>{isEditing ? '수정 완료' : '만들기'}</Text>
        )}
      </Pressable>

      {isEditing && (
        <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
          <Text style={styles.deleteButtonText}>모음집 삭제</Text>
        </Pressable>
      )}

      <FavoritePicker
        visible={showFavoritePicker}
        onClose={() => setShowFavoritePicker(false)}
        favorites={favorites}
        slots={slots}
        renderActions={(favorite) => (
          <Pressable style={styles.favoritePickButton} onPress={() => addItemFromFavorite(favorite)}>
            <Text style={styles.favoritePickButtonText}>추가</Text>
          </Pressable>
        )}
      />
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
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 12,
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
    marginBottom: 8,
  },
  timeButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  spinnerBox: {
    alignItems: 'center',
  },
  spinnerDoneButton: {
    alignSelf: 'center',
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
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
    marginTop: 12,
  },
  itemCard: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  itemTitleInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  removeItemText: {
    color: '#FF6B6B',
    fontSize: 13,
  },
  itemDoneButton: {
    marginTop: 4,
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  itemDoneButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  collapsedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  collapsedItemInfo: {
    flex: 1,
  },
  collapsedItemTitle: {
    fontSize: 15,
  },
  collapsedItemMeta: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  addItemRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  addItemButtonFlex: {
    flex: 1,
  },
  addItemButton: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addItemButtonText: {
    color: '#7C5CFC',
    fontSize: 13,
    fontWeight: '600',
  },
  favoritePickButton: {
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  favoritePickButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  error: {
    color: '#FF6B6B',
    marginTop: 16,
  },
  saveButton: {
    marginTop: 24,
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
