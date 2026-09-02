import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
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
import { AuthProvider, useAuth } from '@/lib/auth-context';

// react-navigation의 기본 테마는 헤더바/탭바 배경을 자체 회색으로 칠해서, 우리 Colors.ts
// 배경색을 바꿔도 그 부분만 예전 색 그대로 남아있었다 — 우리 배경색으로 맞춰서 통일한다
const AppLightTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: Colors.light.background, card: Colors.light.background },
};
const AppDarkTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Colors.dark.background, card: Colors.dark.background },
};
import { persistOptions, queryClient } from '@/lib/query-client';

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
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
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
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthFlow = segments[0] === 'login' || segments[0] === 'auth';

    if (!session && !inAuthFlow) {
      router.replace('/login');
    } else if (session && inAuthFlow) {
      router.replace('/(tabs)');
    }
  }, [session, isLoading, segments, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? AppDarkTheme : AppLightTheme}>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
          <Stack.Screen
            name="routine-form"
            options={{ presentation: 'modal', title: '루틴' }}
          />
          <Stack.Screen name="presets" options={{ title: '모음집' }} />
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
            options={{ presentation: 'modal', title: '일기' }}
          />
          <Stack.Screen name="llm-input" options={{ title: '' }} />
          <Stack.Screen name="videos" options={{ title: '영상' }} />
          <Stack.Screen
            name="video-player"
            options={{ title: '영상 재생', gestureEnabled: false }}
          />
          <Stack.Screen name="settings" options={{ title: '설정' }} />
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
