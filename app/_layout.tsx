import { CuteFont_400Regular } from '@expo-google-fonts/cute-font';
import { Quicksand_600SemiBold, Quicksand_700Bold } from '@expo-google-fonts/quicksand';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AccentColorProvider, useAccentColor } from '@/lib/accent-color';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { KoreanFontProvider, useKoreanFont } from '@/lib/korean-font';
import { OnboardingProvider, useOnboarding } from '@/lib/onboarding';
import { persistOptions, queryClient } from '@/lib/query-client';

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

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ...FontAwesome.font,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
    CuteFont_400Regular,
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
          <KoreanFontProvider>
            <OnboardingProvider>
              <AuthProvider>
                <RootLayoutNav />
              </AuthProvider>
            </OnboardingProvider>
          </KoreanFontProvider>
        </AccentColorProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const appTheme = useAppTheme();
  const koreanFont = useKoreanFont();
  const { session, isLoading } = useAuth();
  const { seen: onboardingSeen } = useOnboarding();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || onboardingSeen === null) return;

    const inAuthFlow = segments[0] === 'login' || segments[0] === 'auth';

    if (!session && !inAuthFlow) {
      router.replace('/login');
      return;
    }

    if (session && !onboardingSeen && segments[0] !== 'onboarding') {
      router.replace('/onboarding');
      return;
    }

    if (session && inAuthFlow) {
      router.replace('/(tabs)');
    }
  }, [session, isLoading, onboardingSeen, segments, router]);

  return (
    <ThemeProvider value={appTheme}>
      {isLoading || (session && onboardingSeen === null) ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <Stack
          screenOptions={{
            headerTitleStyle: { fontFamily: koreanFont.fontFamily, fontSize: 17 + koreanFont.sizeAdjust },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
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
            options={{ presentation: 'modal', title: '모음집' }}
          />
          <Stack.Screen name="favorites" options={{ title: '즐겨찾기' }} />
          <Stack.Screen
            name="favorite-form"
            options={{ presentation: 'modal', title: '즐겨찾기' }}
          />
          <Stack.Screen
            name="diary-form"
            options={{ presentation: 'modal', title: '' }}
          />
          <Stack.Screen name="llm-input" options={{ title: '' }} />
          <Stack.Screen name="videos" options={{ title: '' }} />
          <Stack.Screen
            name="video-player"
            options={{ title: '영상 재생', gestureEnabled: false }}
          />
          <Stack.Screen name="settings" options={{ title: '' }} />
          <Stack.Screen name="slot-settings" options={{ title: '슬롯시간 설정' }} />
          <Stack.Screen name="routine-trash" options={{ title: '루틴 복구' }} />
        </Stack>
      )}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
