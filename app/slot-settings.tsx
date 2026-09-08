import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted, withAlpha } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from '@/lib/language';
import { requestNotificationPermissions, syncReminderAlarm, syncSlotAlarms } from '@/lib/notifications';
import { fetchSlots, updateSlot, SLOT_LABEL_KEYS, type Slot, type SlotType } from '@/lib/routines';

const SLOT_ORDER: SlotType[] = ['morning', 'lunch', 'evening', 'before_sleep'];
// 슬롯별 안내문 자동 펼침을 걷어내면서 상단 공용 안내문의 노출 조건이 바뀌었으므로,
// 예전에 이미 "봤음" 처리된 기기에서도 한 번 더 자동으로 보여주기 위해 키 버전을 올림
const NOTICE_SEEN_KEY = 'settings_notice_seen_v3';

function timeToDate(time: string): Date {
  const date = new Date();
  const [h, m] = time.split(':').map(Number);
  date.setHours(h, m, 0, 0);
  return date;
}

function dateToTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}:00`;
}

export default function SlotSettingsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(accent), [accent]);
  // 즐겨찾기/모음집 폼 등과 같은 쿼리 키('slots')를 써서 캐시를 공유한다
  const slotsQueryKey = ['slots', userId] as const;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<{ slotId: string; field: 'start' | 'end' } | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  // 체크형/정확한 시간 설명은 슬롯별로 접었다 펼 수 있음 — 여기 들어있는 슬롯 id만 펼쳐진 상태.
  // 최초 진입 시 자동으로 펼치지 않음(맨 위 공용 안내문만 자동으로 펼침) — 슬롯 카드마다 다 펼쳐지면 지저분해 보여서
  const [expandedHintSlotIds, setExpandedHintSlotIds] = useState<Set<string>>(new Set());
  const [showMemoHint, setShowMemoHint] = useState(false);
  // iOS 스피너가 열려있는 동안 고르고 있는 값 — routine-form.tsx와 동일한 패턴
  const pickerDraftRef = useRef<Date | null>(null);
  const [pickerOpenValue, setPickerOpenValue] = useState<Date | null>(null);

  const slotsQuery = useQuery({
    queryKey: slotsQueryKey,
    queryFn: async () => {
      const fetched = await fetchSlots(userId!);
      return fetched.slice().sort((a, b) => SLOT_ORDER.indexOf(a.slot_type) - SLOT_ORDER.indexOf(b.slot_type));
    },
    enabled: !!userId,
  });
  const slots = slotsQuery.data ?? [];
  const isLoading = slotsQuery.isLoading;

  useEffect(() => {
    if (slotsQuery.isError) setErrorMessage(t('slotSettings.errorLoad'));
  }, [slotsQuery.isError]);

  // 이 안내는 최초 1회만 자동으로 펼쳐서 보여주고, 그다음부터는 아이콘만 보이다가 누르면 펼쳐짐
  useEffect(() => {
    AsyncStorage.getItem(NOTICE_SEEN_KEY).then((seen) => {
      if (seen === 'true') return;
      setShowNotice(true);
      AsyncStorage.setItem(NOTICE_SEEN_KEY, 'true');
    });
  }, []);

  function toggleHint(slotId: string) {
    setExpandedHintSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  }

  async function resync() {
    if (!userId) return;
    await syncSlotAlarms(userId);
    await syncReminderAlarm(userId);
  }

  async function saveSlot(updated: Slot) {
    queryClient.setQueryData(slotsQueryKey, (prev?: Slot[]) =>
      prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev
    );
    try {
      await updateSlot(updated.id, {
        start_time: updated.start_time,
        end_time: updated.end_time,
        notify_enabled: updated.notify_enabled,
        memo_notify_enabled: updated.memo_notify_enabled,
        is_instant: updated.is_instant,
      });
      await resync();
    } catch (err) {
      setErrorMessage(t('slotSettings.errorSave'));
    }
  }

  async function handleToggleNotify(slot: Slot, value: boolean) {
    if (value) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(t('slotSettings.notifyPermissionTitle'), t('slotSettings.notifyPermissionDesc'));
        return;
      }
    }
    saveSlot({ ...slot, notify_enabled: value });
  }

  function handleToggleMemoNotify(slot: Slot, value: boolean) {
    saveSlot({ ...slot, memo_notify_enabled: value });
  }

  // 시작 시각이 바뀌면 끝 시각도 항상 시작 시각 +1시간으로 맞춰준다(routine-form.tsx와 동일한 규칙) —
  // 안 그러면 시작을 끝보다 늦은 시각으로 옮겼을 때 "끝이 시작보다 이전 시각"으로 보이는 문제가 생김
  function applySlotStartTime(slot: Slot, newStart: Date) {
    const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);
    saveSlot({ ...slot, start_time: dateToTimeString(newStart), end_time: dateToTimeString(newEnd) });
  }

  // 끝 시각은 시작 시각보다 늦어야만 반영한다. 자정(00:00)은 시계로 24:00을 고를 수 없어
  // 저장상 00:00으로 들어오는 경우라 예외로 허용한다(routine-form.tsx와 동일한 규칙)
  function applySlotEndTime(slot: Slot, newEnd: Date) {
    const start = timeToDate(slot.start_time);
    const isMidnight = newEnd.getHours() === 0 && newEnd.getMinutes() === 0;
    if (!isMidnight && newEnd.getTime() <= start.getTime()) return;
    saveSlot({ ...slot, end_time: dateToTimeString(newEnd) });
  }

  function handleTimeChange(slot: Slot, field: 'start' | 'end') {
    return (event: DateTimePickerEvent, date?: Date) => {
      setPickerFor(null);
      if (event.type !== 'set' || !date) return;
      if (field === 'start') applySlotStartTime(slot, date);
      else applySlotEndTime(slot, date);
    };
  }

  function openTimePicker(slot: Slot, field: 'start' | 'end') {
    const current = timeToDate(field === 'start' ? slot.start_time : slot.end_time);
    pickerDraftRef.current = current;
    setPickerOpenValue(current);
    setPickerFor({ slotId: slot.id, field });
  }

  function handleSpinnerTimeChange(event: DateTimePickerEvent, date?: Date) {
    if (date) pickerDraftRef.current = date;
  }

  function confirmSpinnerTime(slot: Slot, field: 'start' | 'end') {
    const picked = pickerDraftRef.current;
    if (picked) {
      if (field === 'start') applySlotStartTime(slot, picked);
      else applySlotEndTime(slot, picked);
    }
    pickerDraftRef.current = null;
    setPickerOpenValue(null);
    setPickerFor(null);
  }

  // 체크형(정확히 한 시각) ↔ 정확한 시간(몇시~몇시 범위) 전환. start_time/end_time은 안 건드리고
  // is_instant만 바꾼다 — 신규 가입자는 트리거가 이미 07:00~08:00 같은 기본값을 넣어주므로 처음
  // 전환할 때도 자연스러운 값이 보이고, 한 번이라도 직접 커스텀한 값은 모드를 왔다갔다 해도
  // 항상 그대로 유지된다(예전엔 전환할 때마다 기본값으로 되돌아가서 커스텀 값을 잃는 문제가 있었음)
  function handleSetTimeMode(slot: Slot, instant: boolean) {
    if (slot.is_instant === instant) return;
    saveSlot({ ...slot, is_instant: instant });
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
      {showNotice ? (
        <AnimatedPressable onPress={() => setShowNotice(false)}>
          <Text style={styles.sectionDesc}>{t('slotSettings.noticeDesc')}</Text>
          <Text style={styles.sectionNote}>{t('slotSettings.noticeNote')}</Text>
        </AnimatedPressable>
      ) : (
        <AnimatedPressable style={styles.noticeCollapsed} onPress={() => setShowNotice(true)} hitSlop={8}>
          <Text style={styles.noticeIcon}>ⓘ</Text>
        </AnimatedPressable>
      )}

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {slots.map((slot) => (
        <ShadowCard key={slot.id} style={styles.slotCardOuter} contentStyle={styles.slotCard}>
          <View style={styles.slotHeaderRow}>
            <Text style={styles.slotLabel}>{t(SLOT_LABEL_KEYS[slot.slot_type])}</Text>
            <Switch
              value={slot.notify_enabled}
              onValueChange={(v) => handleToggleNotify(slot, v)}
              trackColor={{ false: '#ccc', true: withAlpha(accent, 0.4) }}
              thumbColor={slot.notify_enabled ? accent : '#f4f3f4'}
            />
          </View>
          <View style={styles.timeRow}>
            {slot.is_instant ? (
              <AnimatedPressable style={styles.timeButton} onPress={() => openTimePicker(slot, 'start')}>
                <Text>{slot.start_time.slice(0, 5)}</Text>
              </AnimatedPressable>
            ) : (
              <>
                <AnimatedPressable style={styles.timeButton} onPress={() => openTimePicker(slot, 'start')}>
                  <Text>{slot.start_time.slice(0, 5)}</Text>
                </AnimatedPressable>
                <Text>~</Text>
                <AnimatedPressable style={styles.timeButton} onPress={() => openTimePicker(slot, 'end')}>
                  <Text>{slot.end_time.slice(0, 5)}</Text>
                </AnimatedPressable>
              </>
            )}
            <AnimatedPressable
              style={styles.modeToggleButton}
              onPress={() => handleSetTimeMode(slot, !slot.is_instant)}>
              <Text style={styles.modeToggleButtonText}>
                {slot.is_instant ? t('slotSettings.modeCheck') : t('slotSettings.modeExact')}
              </Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.hintToggle} onPress={() => toggleHint(slot.id)} hitSlop={8}>
              <Text style={styles.hintToggleIcon}>ⓘ</Text>
            </AnimatedPressable>
          </View>
          {expandedHintSlotIds.has(slot.id) && (
            <View style={styles.timeModeHintRow}>
              <Ionicons name={slot.is_instant ? 'notifications-outline' : 'time-outline'} size={12} color={textMuted} />
              <Text style={styles.timeModeHint}>
                {slot.is_instant ? t('slotSettings.hintInstant') : t('slotSettings.hintExact')}
              </Text>
            </View>
          )}

          {/* 안드로이드는 시계가 OS 다이얼로그로 뜨고 확인/취소를 누르면 스스로 닫히므로 그때마다
              pickerFor를 꺼줘야 함. iOS는 계속 스크롤 가능한 스피너라 "완료" 버튼으로 닫음 —
              routine-form.tsx와 동일한 패턴 */}
          {pickerFor?.slotId === slot.id &&
            (Platform.OS === 'android' ? (
              <DateTimePicker
                value={timeToDate(pickerFor.field === 'start' ? slot.start_time : slot.end_time)}
                mode="time"
                display="spinner"
                minuteInterval={15}
                onChange={handleTimeChange(slot, pickerFor.field)}
              />
            ) : (
              <View style={styles.spinnerBox}>
                <DateTimePicker
                  value={pickerOpenValue ?? timeToDate(slot.start_time)}
                  mode="time"
                  display="spinner"
                  minuteInterval={15}
                  onChange={handleSpinnerTimeChange}
                />
                <AnimatedPressable
                  style={styles.spinnerDoneButton}
                  onPress={() => confirmSpinnerTime(slot, pickerFor.field)}>
                  <Text style={styles.spinnerDoneText}>{t('common.done')}</Text>
                </AnimatedPressable>
              </View>
            ))}
          {slot.slot_type === 'morning' && (
            <View style={styles.memoNotifyRow}>
              <View style={styles.memoNotifyHeaderRow}>
                <View style={styles.memoNotifyLabelRow}>
                  <Ionicons name="bookmark-outline" size={12} color={textMuted} />
                  <Text style={styles.memoNotifyLabel}>{t('slotSettings.memoNotifyLabel')}</Text>
                  <AnimatedPressable onPress={() => setShowMemoHint((v) => !v)} hitSlop={8}>
                    <Text style={styles.hintToggleIcon}>ⓘ</Text>
                  </AnimatedPressable>
                </View>
                <Switch
                  value={slot.memo_notify_enabled}
                  onValueChange={(v) => handleToggleMemoNotify(slot, v)}
                  trackColor={{ false: '#ccc', true: withAlpha(accent, 0.4) }}
                  thumbColor={slot.memo_notify_enabled ? accent : '#f4f3f4'}
                />
              </View>
              {showMemoHint && <Text style={styles.timeModeHint}>{t('slotSettings.memoNotifyHint')}</Text>}
            </View>
          )}
        </ShadowCard>
      ))}
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
    sectionDesc: {
      fontSize: 13,
      opacity: 0.6,
      marginBottom: 16,
      lineHeight: 18,
    },
    sectionNote: {
      fontSize: 12,
      opacity: 0.5,
      marginTop: -8,
      marginBottom: 16,
      lineHeight: 16,
    },
    noticeCollapsed: {
      alignSelf: 'flex-start',
      marginBottom: 16,
    },
    noticeIcon: {
      fontSize: 16,
      color: '#999',
    },
    error: {
      color: '#FF6B6B',
      marginBottom: 12,
    },
    slotCardOuter: {
      marginBottom: 12,
    },
    slotCard: {
      padding: 12,
    },
    slotHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    slotLabel: {
      fontSize: 15,
      fontWeight: '600',
    },
    timeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    timeButton: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: cardRadius,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    modeToggleButton: {
      borderWidth: 1,
      borderColor: accent,
      borderRadius: cardRadius,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginLeft: 4,
    },
    modeToggleButtonText: {
      fontSize: 12,
      color: accent,
      fontWeight: '600',
    },
    hintToggle: {
      marginLeft: 2,
    },
    hintToggleIcon: {
      fontSize: 14,
      color: '#999',
    },
    timeModeHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 6,
    },
    timeModeHint: {
      fontSize: 11,
      opacity: 0.5,
      flexShrink: 1,
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
    memoNotifyRow: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    memoNotifyHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    memoNotifyLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flex: 1,
      marginRight: 8,
    },
    memoNotifyLabel: {
      fontSize: 12,
      opacity: 0.7,
    },
  });
}
