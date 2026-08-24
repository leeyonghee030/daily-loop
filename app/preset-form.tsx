import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { Chip } from '@/components/Chip';
import { FavoritePicker } from '@/components/FavoritePicker';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { fetchFavorites, type Favorite } from '@/lib/favorites';
import { applyPreset, deletePreset, fetchPresetWithItems, savePreset, type PresetItemInput } from '@/lib/presets';
import { fetchSlots, SLOT_LABELS, type BlockType, type RepeatType, type Slot } from '@/lib/routines';

const REPEAT_OPTIONS: { value: Exclude<RepeatType, 'once'>; label: string }[] = [
  { value: 'daily', label: '매일' },
  { value: 'weekday', label: '평일' },
  { value: 'weekend', label: '주말' },
  { value: 'custom', label: '특정 요일' },
];

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const TRACKING_UNIT_PRESETS = ['잔', '개', '분', '페이지', 'km'];

type ItemDraft = PresetItemInput & { key: string; collapsed: boolean };

function itemSummary(item: ItemDraft, slots: Slot[]): string {
  const timePart = item.scheduled_time_start
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
  const [activeTimePicker, setActiveTimePicker] = useState<{
    index: number;
    field: 'start' | 'end';
  } | null>(null);
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
        setItems(
          fetchedItems.map((item) => ({
            key: makeKey(),
            title: item.title,
            block_type: item.block_type,
            scheduled_time_start: item.scheduled_time_start,
            scheduled_time_end: item.scheduled_time_end,
            slot_id: item.slot_id,
            is_required: item.is_required,
            tracking_unit: item.tracking_unit,
            collapsed: true,
          }))
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
        slot_id: slots.find((s) => s.slot_type === 'morning')?.id ?? slots[0]?.id ?? null,
        is_required: false,
        tracking_unit: null,
        collapsed: false,
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
        slot_id: favorite.slot_id,
        is_required: favorite.is_required,
        tracking_unit: favorite.tracking_unit,
        collapsed: true,
      },
    ]);
    setShowFavoritePicker(false);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function collapseItem(index: number) {
    if (!items[index].title.trim()) return;
    updateItem(index, { collapsed: true });
  }

  function setItemTimeMode(index: number, mode: 'exact' | 'slot') {
    if (mode === 'exact') {
      updateItem(index, {
        slot_id: null,
        scheduled_time_start: dateToTimeString(timeToDate('09:00')),
        scheduled_time_end: dateToTimeString(timeToDate('10:00')),
      });
    } else {
      updateItem(index, {
        scheduled_time_start: null,
        scheduled_time_end: null,
        slot_id: slots.find((s) => s.slot_type === 'morning')?.id ?? slots[0]?.id ?? null,
      });
    }
  }

  function handleTimeChange(event: DateTimePickerEvent, date?: Date) {
    const picker = activeTimePicker;
    setActiveTimePicker(null);
    if (!picker || event.type !== 'set' || !date) return;
    const field = picker.field === 'start' ? 'scheduled_time_start' : 'scheduled_time_end';
    updateItem(picker.index, { [field]: dateToTimeString(date) } as Partial<ItemDraft>);
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
      const presetId = await savePreset(
        userId,
        id ?? null,
        {
          name: name.trim(),
          repeat_type: repeatType,
          repeat_days: repeatType === 'custom' ? repeatDays : null,
          skip_holidays: skipHolidays,
        },
        items.map(({ key, collapsed, ...rest }) => ({ ...rest, title: rest.title.trim() }))
      );
      // 새로 만든 모음집은 저장과 동시에 오늘 목록에도 바로 적용한다 —
      // "만들었는데 내 루틴에 안 보인다"는 혼란을 줄이기 위함. 원치 않는 루틴은 "일시정지"로 끄면 됨.
      // 기존 모음집 수정은 이미 적용된 루틴에 영향 없이 템플릿만 바뀜(기존 동작 유지)
      if (!isEditing) {
        const count = await applyPreset(userId, presetId);
        Alert.alert(
          '모음집을 만들었어요',
          `루틴 ${count}개가 오늘 목록에 바로 추가됐어요. 원치 않는 항목은 "내 루틴"에서 일시정지할 수 있어요.`,
          [{ text: '확인', onPress: () => router.back() }]
        );
      } else {
        router.back();
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
        const timeMode = item.scheduled_time_start ? 'exact' : 'slot';

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
              <Chip label="정확한 시각" selected={timeMode === 'exact'} onPress={() => setItemTimeMode(index, 'exact')} />
              <Chip label="슬롯" selected={timeMode === 'slot'} onPress={() => setItemTimeMode(index, 'slot')} />
            </View>

            {timeMode === 'exact' ? (
              <View style={styles.chipRow}>
                <Pressable
                  style={styles.timeButton}
                  onPress={() => setActiveTimePicker({ index, field: 'start' })}>
                  <Text>{(item.scheduled_time_start ?? '09:00:00').slice(0, 5)}</Text>
                </Pressable>
                <Text>~</Text>
                <Pressable
                  style={styles.timeButton}
                  onPress={() => setActiveTimePicker({ index, field: 'end' })}>
                  <Text>{(item.scheduled_time_end ?? '10:00:00').slice(0, 5)}</Text>
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

      {activeTimePicker && (
        <DateTimePicker
          value={timeToDate(
            activeTimePicker.field === 'start'
              ? items[activeTimePicker.index].scheduled_time_start
              : items[activeTimePicker.index].scheduled_time_end
          )}
          mode="time"
          onChange={handleTimeChange}
        />
      )}

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
