const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @sentry/react-native → @sentry/react → @sentry/browser 순으로 딸려 들어오는
// @sentry-internal/browser-utils(웹 전용, react-native와는 무관한 코드)의 package.json
// "exports" 필드가 Metro의 패키지 exports 해석 방식과 안 맞아서(2026-09-30, "../../types.js를
// 못 찾는다" 번들링 에러) 앱이 아예 안 켜졌다 — Metro가 exports 필드 대신 예전 방식(main/browser
// 필드)으로 모듈을 찾게 하면 이 라이브러리가 올바른(react-native용) 진입점을 쓰게 된다
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
