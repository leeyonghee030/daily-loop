import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchMemosInRange, type DateMemo } from '@/lib/date-memos';
import { channelIdForPrefs, getNotificationPrefs, type NotificationPrefs } from '@/lib/notification-prefs';
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

// 안드로이드는 "매일 반복" 알람을 정확한 시각에 안 울려도 되는 걸로 취급해서(배터리 절약
// OS 정책, SCHEDULE_EXACT_ALARM 권한도 반복 알람엔 적용 안 됨) 몇 분씩 밀려서 오는 문제가
// 있었다 — 반복 알람 대신 "한 번만 울리는 정확한 알람"을 날짜별로 미리 여러 개 예약해두는
// 방식으로 바꾼다. 이 기간 안에서라도 한 번씩만 앱을 열면 항상 정확한 시각에 온다 — 그 이상
// 앱을 안 열면 그 이후분은 채워지지 않아 알림이 끊긴다
// (iOS가 앱당 예약 가능한 알림을 64개로 제한해서, 슬롯 4개 기준 14일이 안전한 상한선)
const SLOT_NOTIFY_WINDOW_DAYS = 14;

// hour:minute 기준 "다음 발송 시점"(오늘 이 시각이 안 지났으면 오늘, 지났으면 내일)부터
// dayOffset일 뒤의 날짜 — 슬롯 알림을 며칠치씩 미리 예약할 때 하루하루의 기준 날짜로 쓴다
function occurrenceDate(hour: number, minute: number, dayOffset: number): Date {
  const now = new Date();
  const base = new Date();
  base.setHours(hour, minute, 0, 0);
  if (base <= now) base.setDate(base.getDate() + 1);
  base.setDate(base.getDate() + dayOffset);
  return base;
}

// 앱을 열 때마다(또는 슬롯 설정이 바뀔 때마다) syncSlotAlarms가 불리는데, 매번 14일치를
// 전부 취소하고 다시 예약하면 낭비다 — 설정이 그대로면 "이미 채워둔 기간에서 흘러간 며칠만
// 다시 채워 넣는" 방식으로 불필요한 취소/예약 호출을 줄인다. 마커에는 마지막으로 쓴 설정
// 값(바뀌었는지 판단용)과 이미 채워둔 마지막 날짜를 기기에 저장해둔다
type SyncMarker = { signature: string; throughDate: string };
const SYNC_MARKER_PREFIX = 'notify-sync-marker:';

async function readSyncMarker(slotType: SlotType): Promise<SyncMarker | null> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_MARKER_PREFIX + slotType);
    return raw ? (JSON.parse(raw) as SyncMarker) : null;
  } catch {
    return null;
  }
}

async function writeSyncMarker(slotType: SlotType, marker: SyncMarker): Promise<void> {
  await AsyncStorage.setItem(SYNC_MARKER_PREFIX + slotType, JSON.stringify(marker)).catch(() => {});
}

async function clearSyncMarker(slotType: SlotType): Promise<void> {
  await AsyncStorage.removeItem(SYNC_MARKER_PREFIX + slotType).catch(() => {});
}

// start(포함) ~ end(포함) 사이의 날짜 문자열 목록 — 설정이 바뀌었을 때 예전에 예약해뒀을
// 수 있는 범위를 정리(취소)하는 용도
function dateStrRange(startDateStr: string, endDateStr: string): string[] {
  if (startDateStr > endDateStr) return [];
  const result: string[] = [];
  const cursor = new Date(`${startDateStr}T00:00:00`);
  const end = new Date(`${endDateStr}T00:00:00`);
  while (cursor <= end) {
    result.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// 안드로이드 채널은 한 번 만들면 소리/진동을 앱에서 되돌릴 수 없어서, 소리/진동 설정
// 조합마다 별도 채널을 만들어두고 그때그때 맞는 채널 id를 골라 쓴다(notification-prefs.ts).
// 설정 화면에서 소리/진동을 바꿀 때마다 새 조합의 채널을 미리 만들어두기 위해 호출한다.
export async function setupNotificationChannel(prefs?: NotificationPrefs): Promise<string> {
  const resolved = prefs ?? (await getNotificationPrefs());
  const channelId = channelIdForPrefs(resolved);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(channelId, {
      name: '루틴 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: resolved.soundEnabled ? 'default' : null,
      vibrationPattern: resolved.vibrationEnabled ? [0, 250, 250, 250] : undefined,
      enableVibrate: resolved.vibrationEnabled,
    });
  }
  return channelId;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function slotIdentifier(slotType: SlotType, dateStr: string): string {
  return `slot-${slotType}-${dateStr}`;
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
// 아침 슬롯은 그날그날 메모 유무에 따라 문구가 달라져야 해서, 기간 전체(최대
// SLOT_NOTIFY_WINDOW_DAYS일)의 메모를 한 번의 조회로 가져와 날짜별로 나눠 담아둔 뒤
// 하루씩 알림 문구를 만든다 — 하루마다 따로 조회하면 네트워크 왕복이 그만큼 늘어나 느려진다
async function scheduleMorningAlarms(
  userId: string,
  slot: Slot,
  channelId: string,
  soundEnabled: boolean
): Promise<void> {
  const routineOn = slot.notify_enabled;
  const memoOn = slot.memo_notify_enabled;
  if (!routineOn && !memoOn) return;

  const [hour, minute] = slot.start_time.split(':').map(Number);
  const memosByDate = new Map<string, DateMemo[]>();
  if (memoOn) {
    const firstDate = formatLocalDate(occurrenceDate(hour, minute, 0));
    const lastDate = formatLocalDate(occurrenceDate(hour, minute, SLOT_NOTIFY_WINDOW_DAYS - 1));
    const memos = await fetchMemosInRange(userId, firstDate, lastDate);
    for (const memo of memos) {
      if (!memosByDate.has(memo.memo_date)) memosByDate.set(memo.memo_date, []);
      memosByDate.get(memo.memo_date)!.push(memo);
    }
  }

  await Promise.all(
    Array.from({ length: SLOT_NOTIFY_WINDOW_DAYS }, async (_, dayOffset) => {
      const targetDate = occurrenceDate(hour, minute, dayOffset);
      const dayMemos = memosByDate.get(formatLocalDate(targetDate)) ?? [];
      const hasMemo = dayMemos.length > 0;
      if (!routineOn && !hasMemo) return;

      let title: string;
      let body: string;
      if (routineOn && hasMemo) {
        title = `${SLOT_LABELS.morning} 시간이에요`;
        body = `오늘의 루틴을 확인해보세요\n📌 메모 ${dayMemos.length}개: ${dayMemos.map((m) => m.content).join(', ')}`;
      } else if (routineOn) {
        title = `${SLOT_LABELS.morning} 시간이에요`;
        body = '오늘의 루틴을 확인해보세요';
      } else {
        title = '오늘 메모가 있어요';
        body = `📌 메모 ${dayMemos.length}개: ${dayMemos.map((m) => m.content).join(', ')}`;
      }

      await Notifications.scheduleNotificationAsync({
        identifier: slotIdentifier('morning', formatLocalDate(targetDate)),
        content: { title, body, sound: soundEnabled },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: targetDate,
          channelId,
        },
      });
    })
  );
}

// 슬롯별 알림: 켜져 있는 슬롯마다 그 슬롯 시작 시각으로 앞으로 SLOT_NOTIFY_WINDOW_DAYS일치를
// "한 번만 울리는 정확한 알람"으로 미리 예약(반복 알람의 몇 분 오차 문제 회피, 위 설명 참고).
// 단, 아침 슬롯은 메모 통합을 위해 위 scheduleMorningAlarms로 별도 처리(자체적으로 on/off 판단,
// 메모가 앱 다른 곳에서 바뀌었을 수도 있어 매번 그 기간 전체를 다시 채운다 — 최대 14번 호출이라
// 부담은 적음). 그 외 슬롯(점심/저녁/자기전)은 내용이 매일 고정이라, 설정이 그대로면 이미
// 채워둔 기간에서 흘러간 며칠만 채워 넣고 나머지는 건드리지 않는다("2주 유지" 느낌) —
// 앱을 열 때마다 매번 14일 전체를 취소·재예약하는 낭비를 없애기 위함
export async function syncSlotAlarms(userId: string): Promise<void> {
  const prefs = await getNotificationPrefs();
  const channelId = await setupNotificationChannel(prefs);
  const slots = await fetchSlots(userId);

  await Promise.all(
    slots.map(async (slot) => {
      if (slot.slot_type === 'morning') {
        // 메모 알림 여부에 따라 내용이 그때그때 달라질 수 있어 안전하게 항상 전체를 다시 채운다.
        // 취소 대상은 슬롯의 실제 시각과 무관하게 넉넉히(어제 ~ 앞으로 SLOT_NOTIFY_WINDOW_DAYS일)
        // 잡아서, 시각이 바뀐 경우에도 예전에 남아있을 수 있는 예약을 확실히 정리한다
        const today = new Date();
        const rangeStart = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
        const rangeEnd = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + SLOT_NOTIFY_WINDOW_DAYS));
        await Promise.all(
          dateStrRange(rangeStart, rangeEnd).map((d) =>
            Notifications.cancelScheduledNotificationAsync(slotIdentifier('morning', d)).catch(() => {})
          )
        );
        await scheduleMorningAlarms(userId, slot, channelId, prefs.soundEnabled);
        return;
      }

      const marker = await readSyncMarker(slot.slot_type);

      if (!slot.notify_enabled) {
        // 꺼져 있으면 이전에 예약해뒀을 수 있는 기간을 정리하고 마커도 지운다
        if (marker) {
          const today = formatLocalDate(new Date());
          await Promise.all(
            dateStrRange(today, marker.throughDate).map((d) =>
              Notifications.cancelScheduledNotificationAsync(slotIdentifier(slot.slot_type, d)).catch(() => {})
            )
          );
          await clearSyncMarker(slot.slot_type);
        }
        return;
      }

      const [hour, minute] = slot.start_time.split(':').map(Number);
      const signature = `${hour}:${minute}`;
      const targetDates = Array.from({ length: SLOT_NOTIFY_WINDOW_DAYS }, (_, i) =>
        formatLocalDate(occurrenceDate(hour, minute, i))
      );
      const windowEndDate = targetDates[targetDates.length - 1];

      if (marker && marker.signature === signature && marker.throughDate >= windowEndDate) {
        // 시각/토글이 그대로고 이미 필요한 기간이 전부 채워져 있음 — 할 일 없음(호출 0번)
        return;
      }

      let datesToSchedule: string[];
      if (marker && marker.signature === signature) {
        // 시각은 그대로, 흘러간 며칠만 새로 채운다(이미 채워둔 날짜는 건드리지 않음)
        datesToSchedule = targetDates.filter((d) => d > marker.throughDate);
      } else {
        // 시각/토글이 바뀌었거나 처음 동기화 — 예전 값으로 남아있을 수 있는 예약을 넓게
        // 정리(오늘부터 예전에 채워뒀던 마지막 날짜까지)하고 지금 설정으로 전체를 새로 채운다
        if (marker) {
          const today = formatLocalDate(new Date());
          await Promise.all(
            dateStrRange(today, marker.throughDate).map((d) =>
              Notifications.cancelScheduledNotificationAsync(slotIdentifier(slot.slot_type, d)).catch(() => {})
            )
          );
        }
        datesToSchedule = targetDates;
      }

      await Promise.all(
        datesToSchedule.map((d) => {
          const [y, m, day] = d.split('-').map(Number);
          const date = new Date(y, m - 1, day, hour, minute, 0, 0);
          return Notifications.scheduleNotificationAsync({
            identifier: slotIdentifier(slot.slot_type, d),
            content: {
              title: `${SLOT_LABELS[slot.slot_type]} 시간이에요`,
              body: '오늘의 루틴을 확인해보세요',
              sound: prefs.soundEnabled,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date,
              channelId,
            },
          });
        })
      );

      await writeSyncMarker(slot.slot_type, { signature, throughDate: windowEndDate });
    })
  );
}

// 리마인더 알림: 자기전 슬롯 시각 기준, 그 시점에 필수 루틴 중 미완료가 있을 때만 발송.
// 앱을 열거나 완료 상태가 바뀔 때마다 다음 발송 시점(오늘 안 지났으면 오늘, 지났으면 내일)을
// 다시 계산해서 예약/취소한다 — 앱을 그날 다시 안 열어도 마지막으로 예약된 건 그대로 발송됨.
export async function syncReminderAlarm(userId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_IDENTIFIER).catch(() => {});

  const prefs = await getNotificationPrefs();
  const channelId = await setupNotificationChannel(prefs);
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
      sound: prefs.soundEnabled,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: targetDate,
      channelId,
    },
  });
}
