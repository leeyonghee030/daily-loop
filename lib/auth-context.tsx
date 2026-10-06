import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, isLoading: true });

// supabase-js가 세션을 저장하는 키와 동일한 규칙(sb-<프로젝트ref>-auth-token) — 저장된
// 토큰이 만료된 채로 오프라인에서 앱을 열면 아래 타임아웃 우회용으로 직접 읽어야 하기 때문
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const AUTH_STORAGE_KEY = `sb-${SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]}-auth-token`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let settled = false;

    supabase.auth.getSession().then(({ data }) => {
      settled = true;
      setSession(data.session);
      setIsLoading(false);
    });

    // 저장된 로그인 토큰이 만료된 채로 완전히 꺼졌다 켜지면, supabase-js가 내부적으로
    // 네트워크 갱신을 0.2초→0.4초→0.8초...로 최대 30초까지 재시도하는 동안 위 getSession()이
    // 응답하지 않는다(라이브러리 자체 동작) — 오프라인이면 이 30초 내내 로딩화면에 멈춰 보이는
    // 버그가 있었음(2026-10-06). 3초 안에 응답이 없으면 저장된 세션을 직접 읽어 일단 들여보내고,
    // 진행 중인 갱신 시도는 그대로 두어 끝나면(성공/실패 둘 다) 결과로 다시 한번 맞춘다 —
    // 갱신 실패 시에도 라이브러리가 기존 세션을 지우지 않고 보존하므로 되돌아와도 값은 같다
    const fallbackTimer = setTimeout(async () => {
      if (settled) return;
      try {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        const stored = raw ? JSON.parse(raw) : null;
        if (stored?.access_token) {
          setSession(stored);
          setIsLoading(false);
        }
      } catch {
        // 저장된 값이 없거나 깨져있으면 원래 getSession() 응답을 계속 기다린다
      }
    }, 3000);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      clearTimeout(fallbackTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
