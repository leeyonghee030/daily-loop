import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const SOUND_KEY = 'notif_sound_enabled';
const VIBRATION_KEY = 'notif_vibration_enabled';

export type NotificationPrefs = {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = { soundEnabled: true, vibrationEnabled: true };

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const [sound, vibration] = await Promise.all([
    AsyncStorage.getItem(SOUND_KEY),
    AsyncStorage.getItem(VIBRATION_KEY),
  ]);
  return {
    soundEnabled: sound !== 'false',
    vibrationEnabled: vibration !== 'false',
  };
}

export async function setNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<void> {
  if (prefs.soundEnabled !== undefined) await AsyncStorage.setItem(SOUND_KEY, String(prefs.soundEnabled));
  if (prefs.vibrationEnabled !== undefined) await AsyncStorage.setItem(VIBRATION_KEY, String(prefs.vibrationEnabled));
}

// 안드로이드 알림 채널은 한 번 만들면 소리/진동 설정을 유저가 직접 안 바꾸는 한 앱에서
// 되돌릴 수 없어서(안드로이드 정책), 설정 조합마다 별도 채널 id를 써서 새로 만든다.
export function channelIdForPrefs(prefs: NotificationPrefs): string {
  return `routine-${prefs.soundEnabled ? 's1' : 's0'}${prefs.vibrationEnabled ? 'v1' : 'v0'}`;
}

// 설정 화면에서 소리/진동 토글을 표시·변경할 때 쓰는 훅
export function useNotificationPrefsSetting() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    getNotificationPrefs().then(setPrefs);
  }, []);

  async function update(partial: Partial<NotificationPrefs>) {
    const next = { ...prefs, ...partial };
    setPrefs(next);
    await setNotificationPrefs(partial);
  }

  return { prefs, update };
}
