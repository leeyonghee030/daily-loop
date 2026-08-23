import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';

import { Chip } from '@/components/Chip';
import { FavoritePicker } from '@/components/FavoritePicker';
import { Text, View } from '@/components/Themed';
import { VideoPicker } from '@/components/VideoPicker';
import { clearPersistedLlmText } from '@/app/llm-input';
import { useAuth } from '@/lib/auth-context';
import { createFavorite, fetchFavorites, type Favorite } from '@/lib/favorites';
import { fetchVideoById, type Video } from '@/lib/videos';
import {
  createRoutine,
  fetchRoutineById,
  fetchSlots,
  softDeleteRoutine,
  updateRoutine,
  uploadRoutinePhoto,
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
  const params = useLocalSearchParams<{
    id?: string;
    // LLM 미리보기에서 넘어온 프리필 값 (app/llm-input.tsx)
    title?: string;
    repeatType?: string;
    repeatDays?: string;
    scheduledTime?: string;
    isRequired?: string;
    blockType?: string;
    trackingUnit?: string;
  }>();
  const { id } = params;
  const isEditing = Boolean(id);
  const prefilled = useRef(false);
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
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [trackingUnit, setTrackingUnit] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [showFavoritePicker, setShowFavoritePicker] = useState(false);
  const [isApplyingFavorite, setIsApplyingFavorite] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [showVideoPicker, setShowVideoPicker] = useState(false);
  const [memo, setMemo] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);

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
    fetchFavorites(userId)
      .then(setFavorites)
      .catch(() => setErrorMessage('즐겨찾기를 불러오지 못했어요.'));
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
        setCategoryId(routine.category_id);
        setMemo(routine.memo ?? '');
        setPhotoUrl(routine.photo_url);
        if (routine.video_id) {
          fetchVideoById(routine.video_id).then(setSelectedVideo).catch(() => {});
        }
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

  // LLM 미리보기에서 넘어온 프리필 값을 폼에 한 번만 반영 (신규 추가일 때만)
  useEffect(() => {
    if (isEditing || prefilled.current) return;
    if (!params.title && !params.repeatType && !params.scheduledTime) return;
    prefilled.current = true;

    if (params.title) setTitle(params.title);
    if (params.blockType === 'tracking') setBlockType('tracking');
    if (params.trackingUnit) setTrackingUnit(params.trackingUnit);
    if (params.repeatType) setRepeatType(params.repeatType as RepeatType);
    if (params.repeatDays) {
      setRepeatDays(params.repeatDays.split(',').filter(Boolean).map(Number));
    }
    if (params.isRequired === 'true') setIsRequired(true);
    if (params.scheduledTime) {
      // LLM은 시작 시각만 주므로 정확한 시각 모드로 두고 종료는 +1시간
      setTimeMode('exact');
      const start = timeToDate(params.scheduledTime);
      setStartTime(start);
      setEndTime(new Date(start.getTime() + 60 * 60 * 1000));
    }
  }, [isEditing, params]);

  function toggleRepeatDay(day: number) {
    setRepeatDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function applyFavoriteToForm(favorite: Favorite) {
    setTitle(favorite.title);
    setBlockType(favorite.block_type);
    setTrackingUnit(favorite.tracking_unit ?? '');
    setIsRequired(favorite.is_required);
    if (favorite.scheduled_time_start && favorite.scheduled_time_end) {
      setTimeMode('exact');
      setStartTime(timeToDate(favorite.scheduled_time_start));
      setEndTime(timeToDate(favorite.scheduled_time_end));
    } else if (favorite.slot_id) {
      setTimeMode('slot');
      setSlotId(favorite.slot_id);
    }
    setShowFavoritePicker(false);
  }

  async function applyFavoriteInstantly(favorite: Favorite) {
    if (!userId) return;
    setIsApplyingFavorite(true);
    setErrorMessage(null);
    try {
      await createRoutine(userId, {
        title: favorite.title,
        block_type: favorite.block_type,
        repeat_type: 'daily',
        repeat_days: null,
        scheduled_time_start: favorite.scheduled_time_start,
        scheduled_time_end: favorite.scheduled_time_end,
        scheduled_date: null,
        slot_id: favorite.slot_id,
        is_required: favorite.is_required,
        tracking_unit: favorite.tracking_unit,
        skip_holidays: false,
        category_id: null,
        video_id: null,
        memo: null,
        photo_url: null,
      });
      setShowFavoritePicker(false);
      router.back();
    } catch (err) {
      setErrorMessage('즐겨찾기 추가에 실패했어요.');
    } finally {
      setIsApplyingFavorite(false);
    }
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

    setIsSaving(true);
    setErrorMessage(null);

    // 사진 업로드가 실패해도 나머지 변경사항(제목/카테고리 등)까지 저장이 막히면 안 되니,
    // 실패 시 사진만 빼고(기존 사진 유지) 저장을 계속 진행한다
    let finalPhotoUrl = photoUrl;
    let photoUploadFailed = false;
    if (newPhotoUri) {
      try {
        finalPhotoUrl = await uploadRoutinePhoto(userId, newPhotoUri);
      } catch {
        photoUploadFailed = true;
        finalPhotoUrl = photoUrl;
      }
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
      category_id: categoryId,
      video_id: selectedVideo?.id ?? null,
      memo: memo.trim() ? memo.trim() : null,
      photo_url: finalPhotoUrl,
    };

    try {
      if (isEditing && id) {
        await updateRoutine(id, input);
      } else {
        await createRoutine(userId, input);
      }
      if (saveAsFavorite) {
        try {
          await createFavorite(userId, {
            title: input.title,
            block_type: input.block_type,
            scheduled_time_start: input.scheduled_time_start,
            scheduled_time_end: input.scheduled_time_end,
            slot_id: input.slot_id,
            is_required: input.is_required,
            tracking_unit: input.tracking_unit,
          });
        } catch (favoriteErr) {
          // 루틴 저장 자체는 성공했으니 즐겨찾기 저장 실패는 조용히 넘어감
        }
      }
      // 말로 루틴 추가에서 넘어온 초안이 실제로 저장 완료됐을 때만 입력 문장을 비운다
      if (prefilled.current && !isEditing) clearPersistedLlmText();
      if (photoUploadFailed) {
        Alert.alert('저장은 됐어요', '다만 사진 업로드는 실패했어요. 나중에 다시 첨부해주세요.', [
          { text: '확인', onPress: () => router.back() },
        ]);
      } else {
        router.back();
      }
    } catch (err) {
      setErrorMessage('저장에 실패했어요. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  }

  async function performDelete() {
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

  function handleDelete() {
    Alert.alert(
      '루틴을 삭제할까요?',
      `"${title}"에 해당하는 모든 예정(반복 전체)이 삭제돼요. 지금까지 체크·기록한 내역은 남아있어요.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: performDelete },
      ]
    );
  }

  function handleTimeChange(setter: (date: Date) => void, hide: () => void) {
    return (event: DateTimePickerEvent, date?: Date) => {
      hide();
      if (event.type === 'set' && date) setter(date);
    };
  }

  async function pickPhoto() {
    setIsPickingPhoto(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('사진 접근 권한이 꺼져있어요', '기기 설정에서 사진 접근 권한을 허용해주세요.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
      });
      if (!result.canceled && result.assets[0]) {
        setNewPhotoUri(result.assets[0].uri);
      }
    } finally {
      setIsPickingPhoto(false);
    }
  }

  function removePhoto() {
    setNewPhotoUri(null);
    setPhotoUrl(null);
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
      {!isEditing && (
        <>
          <Pressable style={styles.favoriteButton} onPress={() => setShowFavoritePicker(true)}>
            <Text style={styles.favoriteButtonText}>⭐ 즐겨찾기에서 불러오기</Text>
          </Pressable>
          <Text style={styles.favoriteHint}>
            저장해둔 루틴 템플릿을 불러와서 바로 추가하거나, 수정해서 추가할 수 있어요.
          </Text>
        </>
      )}

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

      <Text style={styles.label}>영상 연결</Text>
      {selectedVideo ? (
        <Pressable style={styles.selectedVideoRow} onPress={() => setShowVideoPicker(true)}>
          <Image source={{ uri: selectedVideo.thumbnail_url }} style={styles.selectedVideoThumb} />
          <Text style={styles.selectedVideoTitle} numberOfLines={2}>
            {selectedVideo.title}
          </Text>
          <Pressable onPress={() => setSelectedVideo(null)}>
            <Text style={styles.removeVideoText}>✕</Text>
          </Pressable>
        </Pressable>
      ) : (
        <Pressable style={styles.videoConnectButton} onPress={() => setShowVideoPicker(true)}>
          <Text style={styles.videoConnectButtonText}>🎬 영상 선택하기</Text>
        </Pressable>
      )}

      <Text style={styles.label}>메모</Text>
      <TextInput
        style={[styles.input, styles.memoInput]}
        value={memo}
        onChangeText={setMemo}
        placeholder="이 루틴에 대해 간단히 적어두세요 (선택)"
        multiline
      />

      <Text style={styles.label}>사진</Text>
      {newPhotoUri || photoUrl ? (
        <View style={styles.selectedVideoRow}>
          <Image source={{ uri: newPhotoUri ?? photoUrl! }} style={styles.selectedPhotoThumb} />
          <Text style={styles.selectedVideoTitle}>사진 1장 첨부됨</Text>
          <Pressable onPress={removePhoto}>
            <Text style={styles.removeVideoText}>✕</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.videoConnectButton} onPress={pickPhoto} disabled={isPickingPhoto}>
          {isPickingPhoto ? (
            <ActivityIndicator color="#7C5CFC" />
          ) : (
            <Text style={styles.videoConnectButtonText}>📷 사진 추가하기</Text>
          )}
        </Pressable>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.label}>공휴일 제외</Text>
        <Switch value={skipHolidays} onValueChange={setSkipHolidays} />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchRowLabelColumn}>
          <Text style={styles.label}>즐겨찾기에 추가</Text>
          <Text style={styles.favoriteHint}>켜두면 이 내용을 템플릿으로 저장해서 다음에 또 빠르게 추가할 수 있어요.</Text>
        </View>
        <Pressable
          style={[styles.starButton, saveAsFavorite && styles.starButtonActive]}
          onPress={() => setSaveAsFavorite((prev) => !prev)}>
          <Text style={styles.starButtonText}>{saveAsFavorite ? '⭐' : '☆'}</Text>
        </Pressable>
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
          <Text style={styles.deleteButtonText}>루틴삭제</Text>
        </Pressable>
      )}

      <FavoritePicker
        visible={showFavoritePicker}
        onClose={() => setShowFavoritePicker(false)}
        favorites={favorites}
        slots={slots}
        renderActions={(favorite) => (
          <>
            <Pressable
              style={styles.favoriteActionButton}
              disabled={isApplyingFavorite}
              onPress={() => applyFavoriteInstantly(favorite)}>
              <Text style={styles.favoriteActionText}>바로 추가</Text>
            </Pressable>
            <Pressable
              style={[styles.favoriteActionButton, styles.favoriteActionButtonOutline]}
              disabled={isApplyingFavorite}
              onPress={() => applyFavoriteToForm(favorite)}>
              <Text style={[styles.favoriteActionText, styles.favoriteActionTextOutline]}>수정해서 추가</Text>
            </Pressable>
          </>
        )}
      />

      <VideoPicker
        visible={showVideoPicker}
        onClose={() => setShowVideoPicker(false)}
        onSelect={setSelectedVideo}
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
  favoriteButton: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  favoriteButtonText: {
    color: '#7C5CFC',
    fontSize: 14,
    fontWeight: '600',
  },
  favoriteHint: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 6,
    lineHeight: 16,
  },
  switchRowLabelColumn: {
    flex: 1,
    marginRight: 12,
  },
  favoriteActionButton: {
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  favoriteActionButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#7C5CFC',
  },
  favoriteActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  favoriteActionTextOutline: {
    color: '#7C5CFC',
  },
  starButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starButtonActive: {
    borderColor: '#7C5CFC',
  },
  starButtonText: {
    fontSize: 18,
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
    marginTop: 24,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FF6B6B',
    borderRadius: 10,
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  videoConnectButton: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  videoConnectButtonText: {
    color: '#7C5CFC',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedVideoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 8,
  },
  selectedVideoThumb: {
    width: 60,
    height: 34,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  selectedVideoTitle: {
    flex: 1,
    fontSize: 13,
  },
  removeVideoText: {
    fontSize: 16,
    opacity: 0.5,
    paddingHorizontal: 4,
  },
  memoInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  selectedPhotoThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
});
