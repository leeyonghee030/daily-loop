import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchMemosInRange } from '@/lib/date-memos';
import {
  fetchMonthData,
  fetchSlots,
  formatLocalDate,
  routinesForDate,
  SLOT_LABELS,
  type Slot,
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

// 아침 슬롯 알림 + 메모 알림: 두 개는 서로 독립된 채널(각자 토글로 켜고 끔)이지만,
// 같은 시각(아침 슬롯 시작 시각)에 둘 다 보낼 조건이면 알림 하나로 합쳐서 보낸다.
// - 아침 루틴 알림만 켜짐 → 기본 문구만
// - 메모 알림만 켜짐 + 그날 메모 있음 → 메모 내용만
// - 둘 다 켜짐 + 그날 메모 있음 → 합쳐서 발송
// - 둘 다 켜짐 + 메모 없음 → 기본 문구만
// - 둘 다 꺼짐, 또는 메모 알림만 켜졌는데 메모가 없음 → 아무것도 안 보냄
// 메모 유무에 따라 매일 문구가 달라져야 해서, 자기전 리마인더(syncReminderAlarm)와 같은
// "재동기화 때마다 다음 발송 시점 1회성으로 예약" 방식을 그대로 따른다.
async function scheduleMorningAlarm(userId: string, slot: Slot, identifier: string): Promise<void> {
  const routineOn = slot.notify_enabled;
  const memoOn = slot.memo_notify_enabled;
  if (!routineOn && !memoOn) return;

  const [hour, minute] = slot.start_time.split(':').map(Number);
  const now = new Date();
  let targetDate = new Date();
  targetDate.setHours(hour, minute, 0, 0);
  if (targetDate <= now) {
    targetDate = new Date(targetDate);
    targetDate.setDate(targetDate.getDate() + 1);
  }

  let memoCount = 0;
  let memoSummary = '';
  if (memoOn) {
    const dateStr = formatLocalDate(targetDate);
    const memos = await fetchMemosInRange(userId, dateStr, dateStr);
    memoCount = memos.length;
    memoSummary = memos.map((m) => m.content).join(', ');
  }
  const hasMemo = memoCount > 0;

  if (!routineOn && !hasMemo) return;

  let title: string;
  let body: string;
  if (routineOn && hasMemo) {
    title = `${SLOT_LABELS.morning} 시간이에요`;
    body = `오늘의 루틴을 확인해보세요\n📌 메모 ${memoCount}개: ${memoSummary}`;
  } else if (routineOn) {
    title = `${SLOT_LABELS.morning} 시간이에요`;
    body = '오늘의 루틴을 확인해보세요';
  } else {
    title = '오늘 메모가 있어요';
    body = `📌 메모 ${memoCount}개: ${memoSummary}`;
  }

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: targetDate,
    },
  });
}

// 슬롯별 알림: 켜져 있는 슬롯마다 그 슬롯 시작 시각에 매일 반복 알림 예약.
// 단, 아침 슬롯은 메모 통합을 위해 위 scheduleMorningAlarm으로 별도 처리(자체적으로 on/off 판단).
export async function syncSlotAlarms(userId: string): Promise<void> {
  const slots = await fetchSlots(userId);
  for (const slot of slots) {
    const identifier = slotIdentifier(slot.slot_type);
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

    if (slot.slot_type === 'morning') {
      await scheduleMorningAlarm(userId, slot, identifier);
      continue;
    }
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
