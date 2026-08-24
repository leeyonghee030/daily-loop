import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider, useAuth } from '@/lib/auth-context';

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
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
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
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
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
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
