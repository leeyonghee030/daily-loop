import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import {
  requestNotificationPermissions,
  syncReminderAlarm,
  syncSlotAlarms,
} from '@/lib/notifications';
import { fetchSlots, updateSlot, SLOT_LABELS, type Slot, type SlotType } from '@/lib/routines';
import { supabase } from '@/lib/supabase';

const SLOT_ORDER: SlotType[] = ['morning', 'lunch', 'evening', 'before_sleep'];

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

export default function SettingsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<{ slotId: string; field: 'start' | 'end' } | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchSlots(userId)
      .then((fetched) => setSlots(fetched.slice().sort((a, b) => SLOT_ORDER.indexOf(a.slot_type) - SLOT_ORDER.indexOf(b.slot_type))))
      .catch(() => setErrorMessage('슬롯 정보를 불러오지 못했어요.'))
      .finally(() => setIsLoading(false));
  }, [userId]);

  async function resync() {
    if (!userId) return;
    await syncSlotAlarms(userId);
    await syncReminderAlarm(userId);
  }

  async function saveSlot(updated: Slot) {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    try {
      await updateSlot(updated.id, {
        start_time: updated.start_time,
        end_time: updated.end_time,
        notify_enabled: updated.notify_enabled,
      });
      await resync();
    } catch (err) {
      setErrorMessage('저장에 실패했어요.');
    }
  }

  async function handleToggleNotify(slot: Slot, value: boolean) {
    if (value) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert('알림 권한이 꺼져있어요', '기기 설정에서 알림 권한을 허용해주세요.');
        return;
      }
    }
    saveSlot({ ...slot, notify_enabled: value });
  }

  function handleTimeChange(slot: Slot, field: 'start' | 'end') {
    return (event: DateTimePickerEvent, date?: Date) => {
      setPickerFor(null);
      if (event.type !== 'set' || !date) return;
      const timeStr = dateToTimeString(date);
      saveSlot(field === 'start' ? { ...slot, start_time: timeStr } : { ...slot, end_time: timeStr });
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
      <Text style={styles.sectionTitle}>슬롯 시간 / 알림</Text>
      <Text style={styles.sectionDesc}>
        슬롯 알림을 켜면 그 시간대 시작 시각에 매일 알림이 와요. "자기전" 슬롯 알림을 켜두면, 그 시각까지 필수
        루틴을 다 못했을 때만 리마인더 알림도 같이 와요.
      </Text>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {slots.map((slot) => (
        <View key={slot.id} style={styles.slotCard}>
          <View style={styles.slotHeaderRow}>
            <Text style={styles.slotLabel}>{SLOT_LABELS[slot.slot_type]}</Text>
            <Switch value={slot.notify_enabled} onValueChange={(v) => handleToggleNotify(slot, v)} />
          </View>
          <View style={styles.timeRow}>
            <Pressable
              style={styles.timeButton}
              onPress={() => setPickerFor({ slotId: slot.id, field: 'start' })}>
              <Text>{slot.start_time.slice(0, 5)}</Text>
            </Pressable>
            <Text>~</Text>
            <Pressable
              style={styles.timeButton}
              onPress={() => setPickerFor({ slotId: slot.id, field: 'end' })}>
              <Text>{slot.end_time.slice(0, 5)}</Text>
            </Pressable>
          </View>
          {pickerFor?.slotId === slot.id && (
            <DateTimePicker
              value={timeToDate(pickerFor.field === 'start' ? slot.start_time : slot.end_time)}
              mode="time"
              onChange={handleTimeChange(slot, pickerFor.field)}
            />
          )}
        </View>
      ))}

      <Text style={styles.sectionTitle}>계정</Text>
      <Text style={styles.accountEmail}>{session?.user.email}</Text>
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>로그아웃</Text>
      </Pressable>
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 16,
    lineHeight: 18,
  },
  error: {
    color: '#FF6B6B',
    marginBottom: 12,
  },
  slotCard: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
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
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  timeButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  accountEmail: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 12,
  },
  signOutButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 8,
  },
  signOutText: {
    color: '#FF6B6B',
    fontWeight: '600',
  },
});
