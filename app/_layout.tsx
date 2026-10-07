import { CuteFont_400Regular } from '@expo-google-fonts/cute-font';
import { Fredoka_400Regular } from '@expo-google-fonts/fredoka';
import { Quicksand_600SemiBold, Quicksand_700Bold } from '@expo-google-fonts/quicksand';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AccentColorProvider, useAccentColor } from '@/lib/accent-color';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { LanguageProvider, useTranslation } from '@/lib/language';
import { KoreanFontProvider, useKoreanFont } from '@/lib/korean-font';
import { OnboardingProvider, useOnboarding } from '@/lib/onboarding';
import { persistOptions, queryClient } from '@/lib/query-client';
import { initSentry, Sentry } from '@/lib/sentry';

initSentry();

// react-navigation의 기본 테마는 헤더바/탭바 배경을 자체 회색으로 칠해서, 우리 Colors.ts
// 배경색을 바꿔도 그 부분만 예전 색 그대로 남아있었다 — 우리 배경색으로 맞춰서 통일한다.
// primary는 사용자가 설정에서 고른 주색(accent)을 그대로 따라간다
function useAppTheme() {
  const accent = useAccentColor();
  const colorScheme = useColorScheme();
  const light = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: Colors.light.background, card: Colors.light.background, primary: accent } };
  const dark = { ...DarkTheme, colors: { ...DarkTheme.colors, background: Colors.dark.background, card: Colors.dark.background, primary: accent } };
  return colorScheme === 'dark' ? dark : light;
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [loaded, error] = useFonts({
    ...FontAwesome.font,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
    CuteFont_400Regular,
    Fredoka_400Regular,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <AccentColorProvider>
          <LanguageProvider>
            <KoreanFontProvider>
              <AuthProvider>
                <OnboardingProvider>
                  <RootLayoutNav />
                </OnboardingProvider>
              </AuthProvider>
            </KoreanFontProvider>
          </LanguageProvider>
        </AccentColorProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const appTheme = useAppTheme();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const { session, isLoading } = useAuth();
  const { seen: onboardingSeen } = useOnboarding();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    // onboardingSeen은 로그아웃 상태에서도 null(서버에 물어볼 계정이 없어서)이라, 세션 유무와
    // 상관없이 무조건 기다리면 로그아웃 상태일 때 아래 로그인 화면 리다이렉트 자체가 영원히
    // 실행되지 않는 버그가 있었음 — 세션이 있을 때만 온보딩 조회가 끝나길 기다린다
    if (session && onboardingSeen === null) return;
    // 화면 전환이 진행되는 바로 그 찰나에 useSegments()가 아주 짧게 빈 배열을 돌려주는
    // 경우가 있다(2026-10-07) — 이때 segments[0]이 undefined가 되어 "온보딩도 투어도 아닌
    // 화면"으로 잘못 판정되면서 온보딩으로 도로 튕겨 보낸 적이 있었다. 이 모호한 신호에는
    // 반응하지 않고 다음 안정된 렌더링을 기다린다
    if (!segments[0]) return;

    const inAuthFlow = segments[0] === 'login' || segments[0] === 'auth';

    if (!session && !inAuthFlow) {
      router.replace('/login');
      return;
    }

    // 온보딩 마지막(테마/폰트/언어 고르기) 화면에서 "시작하기"를 누르면 바로 오늘 탭이 아니라
    // 기능 소개 투어(feature-tour)로 먼저 이동한다 — 이때 아직 onboarding_completed는 true로
    // 안 바뀐 상태(투어의 마지막 화면에서 markSeen 호출)라, feature-tour도 onboarding과 똑같이
    // "아직 안 끝난 것으로 보고 리다이렉트하지 않을" 예외 화면으로 취급해야 한다(2026-09-27)
    if (session && !onboardingSeen && segments[0] !== 'onboarding' && segments[0] !== 'feature-tour') {
      router.replace('/onboarding');
      return;
    }

    // ⚠️ 2026-10-07 — 투어 마지막 화면이 markSeen() 직후 자기 스스로 router.replace('/(tabs)')를
    // 부르고 있었는데, 그 호출이 "markSeen이 서버/캐시에 쓴 onboarding_completed=true"가 이
    // 레이아웃까지 리렌더로 전파되기 *전에* 먼저 도착하는 경우가 있었다(adb logcat으로 실제
    // 순서 확인함) — segments는 이미 "(tabs)"로 바뀌었는데 onboardingSeen은 아직 낡은 false를
    // 보고 있어서, 바로 위 조건에 걸려 다시 온보딩으로 튕겨 보내고 있었던 것(그래서 "시작하기"를
    // 두 번 눌러야 했음). 투어 쪽의 수동 이동을 없애고, "온보딩을 끝냈다(onboardingSeen===true)
    // + 아직 온보딩/투어 화면에 있다"는 조건 하나로 이 레이아웃이 직접 오늘 탭으로 보내도록
    // 통일했다 — onboardingSeen이 실제로 true로 바뀌는 그 렌더링에서만 효과가 실행되므로,
    // 다른 신호(segments)가 먼저 도착해서 아직 안 바뀐 값을 보고 판단하는 경쟁 자체가 없어진다
    if (session && onboardingSeen && (segments[0] === 'onboarding' || segments[0] === 'feature-tour')) {
      router.replace('/(tabs)');
      return;
    }

    if (session && inAuthFlow) {
      router.replace('/(tabs)');
    }
  }, [session, isLoading, onboardingSeen, segments, router]);

  return (
    <ThemeProvider value={appTheme}>
      {isLoading || (session && onboardingSeen === null) ? (
        <AppLoadingScreen />
      ) : (
        <Stack
          screenOptions={{
            headerTitleStyle: { fontFamily: koreanFont.fontFamily, fontSize: 17 + koreanFont.sizeAdjust },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="feature-tour" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
          <Stack.Screen
            name="routine-form"
            options={{ presentation: 'modal', title: '' }}
          />
          <Stack.Screen name="presets" options={{ title: '' }} />
          <Stack.Screen name="my-routines" options={{ title: '' }} />
          <Stack.Screen
            name="preset-form"
            options={{ presentation: 'modal', title: t('nav.preset') }}
          />
          <Stack.Screen name="favorites" options={{ title: t('nav.favorites') }} />
          <Stack.Screen
            name="favorite-form"
            options={{ presentation: 'modal', title: t('nav.favorites') }}
          />
          <Stack.Screen
            name="diary-form"
            options={{ presentation: 'modal', title: '' }}
          />
          <Stack.Screen
            name="photo-diary-form"
            options={{ presentation: 'modal', title: '' }}
          />
          <Stack.Screen name="llm-input" options={{ title: '' }} />
          <Stack.Screen name="videos" options={{ title: '' }} />
          <Stack.Screen
            name="video-player"
            options={{ title: t('nav.videoPlayer'), gestureEnabled: false }}
          />
          <Stack.Screen name="settings" options={{ title: '' }} />
          <Stack.Screen name="slot-settings" options={{ title: t('settings.timeSettings') }} />
          <Stack.Screen name="routine-trash" options={{ title: t('myRoutines.routineTrash') }} />
        </Stack>
      )}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});

// Sentry.wrap으로 감싸야 New Architecture(Fabric)에서도 네이티브 크래시까지 제대로 잡힌다
export default Sentry.wrap(RootLayout);
