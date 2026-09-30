import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Sentry from '@sentry/react-native';

// DSN은 비밀 키가 아니라 "여기로 에러를 보내라"는 주소일 뿐이라 노출돼도 안전하지만(Sentry
// 데이터를 읽으려면 별도 로그인 필요), 그래도 Supabase 키들과 같은 패턴으로 .env에 둔다.
// DSN이 비어있으면(아직 Sentry 프로젝트를 안 만들었을 때) 조용히 아무 것도 안 한다
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

// ⚠️ 2026-09-30 — Expo Go 안에서 Sentry.init()을 그대로 부르면 Expo Go가 이 커스텀 네이티브
// 모듈을 아예 못 실어서(Expo Go는 Expo 자체 SDK 모듈만 내장) 앱이 시작부터 죽는(code 500)
// 버그가 있었다. Expo Go로 돌고 있을 때는 초기화 자체를 건너뛴다 — 실제 확인은 EAS
// 개발/프리뷰/프로덕션 빌드(네이티브 모듈이 정상적으로 포함된 빌드)에서 해야 한다
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function initSentry() {
  if (!dsn || isExpoGo) return;
  Sentry.init({
    dsn,
    // 스토어에 낸 뒤 실제 사용자 기기에서 나는 에러를 잡는 게 목적이라, 개발 중(__DEV__)에는
    // 우리가 직접 보는 콘솔 에러까지 같이 올라가 잡음이 되지 않도록 끈다
    enabled: !__DEV__,
  });
}

export { Sentry };
