import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  fetchMonthData,
  fetchSlots,
  formatLocalDate,
  routinesForDate,
  SLOT_LABELS,
  type SlotType,
} from '@/lib/routines';

const REMINDER_IDENTIFIER = 'reminder-before-sleep';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: '기본 알림',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function slotIdentifier(slotType: SlotType): string {
  return `slot-${slotType}`;
}

// 슬롯별 알림: 켜져 있는 슬롯마다 그 슬롯 시작 시각에 매일 반복 알림 예약
export async function syncSlotAlarms(userId: string): Promise<void> {
  const slots = await fetchSlots(userId);
  for (const slot of slots) {
    const identifier = slotIdentifier(slot.slot_type);
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    if (!slot.notify_enabled) continue;

    const [hour, minute] = slot.start_time.split(':').map(Number);
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: `${SLOT_LABELS[slot.slot_type]} 시간이에요`,
        body: '오늘의 루틴을 확인해보세요',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  }
}

// 리마인더 알림: 자기전 슬롯 시각 기준, 그 시점에 필수 루틴 중 미완료가 있을 때만 발송.
// 앱을 열거나 완료 상태가 바뀔 때마다 다음 발송 시점(오늘 안 지났으면 오늘, 지났으면 내일)을
// 다시 계산해서 예약/취소한다 — 앱을 그날 다시 안 열어도 마지막으로 예약된 건 그대로 발송됨.
export async function syncReminderAlarm(userId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_IDENTIFIER).catch(() => {});

  const slots = await fetchSlots(userId);
  const beforeSleep = slots.find((s) => s.slot_type === 'before_sleep');
  if (!beforeSleep || !beforeSleep.notify_enabled) return;

  const [hour, minute] = beforeSleep.start_time.split(':').map(Number);
  const now = new Date();
  let targetDate = new Date();
  targetDate.setHours(hour, minute, 0, 0);
  if (targetDate <= now) {
    targetDate = new Date(targetDate);
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const dateStr = formatLocalDate(targetDate);
  const monthData = await fetchMonthData(userId, targetDate.getFullYear(), targetDate.getMonth() + 1);
  const scheduled = routinesForDate(dateStr, monthData);
  const hasIncomplete = scheduled.some((s) => s.routine.is_required && !s.completion);
  if (!hasIncomplete) return;

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_IDENTIFIER,
    content: {
      title: '오늘 루틴을 확인해주세요',
      body: '아직 완료하지 않은 루틴이 있어요',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: targetDate,
    },
  });
}
