import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs, useRouter } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { StreakHeaderBadge } from '@/components/StreakHeaderBadge';
import { textMuted } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont } from '@/lib/korean-font';
import { useTranslation } from '@/lib/language';

function TabBarIcon(props: { name: React.ComponentProps<typeof Ionicons>['name']; color: string }) {
  return <Ionicons size={24} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: accent,
        // 안드로이드(특히 갤럭시)는 이 투명+블러 조합이 탭바 배경뿐 아니라 그 아래 시스템
        // 내비게이션 바(뒤로가기/홈/최근앱)까지 투명하게 만들어 배경화면이 비쳐 보이는 문제가
        // 있어서, 블러는 iOS에서만 적용하고 안드로이드는 원래 불투명 배경을 그대로 둔다
        ...(Platform.OS === 'ios'
          ? {
              tabBarStyle: { backgroundColor: 'transparent' },
              tabBarBackground: () => (
                <BlurView tint={colorScheme === 'dark' ? 'dark' : 'light'} intensity={80} style={StyleSheet.absoluteFill} />
              ),
            }
          : {}),
        headerShown: useClientOnlyValue(false, true),
        headerTitleStyle: { fontFamily: koreanFont.fontFamily, fontSize: 20 + koreanFont.sizeAdjust },
        // 탭 상단 큰 제목은 없애되, 탭바 아래쪽 라벨(오늘/캘린더/통계)은 각 화면의 title 값을 그대로 씀.
        // 대신 그 빈 자리(설정 아이콘 왼쪽)에 역대 최고 스트릭을 은은한 장식으로 채운다
        headerTitle: () => <StreakHeaderBadge />,
        headerRight: () => (
          <AnimatedPressable style={{ marginRight: 16 }} onPress={() => router.push('/settings')}>
            <FontAwesome name="gear" size={22} color={textMuted} />
          </AnimatedPressable>
        ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.tabToday'),
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'checkbox' : 'checkbox-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('nav.tabCalendar'),
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'calendar' : 'calendar-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('nav.tabStats'),
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
