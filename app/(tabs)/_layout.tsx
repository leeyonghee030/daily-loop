import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont } from '@/lib/korean-font';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: accent,
        headerShown: useClientOnlyValue(false, true),
        headerTitleStyle: { fontFamily: koreanFont.fontFamily, fontSize: 20 + koreanFont.sizeAdjust },
        // 탭 상단 큰 제목은 없애되, 탭바 아래쪽 라벨(오늘/캘린더/통계)은 각 화면의 title 값을 그대로 씀
        headerTitle: '',
        headerRight: () => (
          <Pressable style={{ marginRight: 16 }} onPress={() => router.push('/settings')}>
            <FontAwesome name="gear" size={22} color={Colors[colorScheme ?? 'light'].text} />
          </Pressable>
        ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '오늘',
          tabBarIcon: ({ color }) => <TabBarIcon name="check-square-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '캘린더',
          tabBarIcon: ({ color }) => <TabBarIcon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: '통계',
          tabBarIcon: ({ color }) => <TabBarIcon name="bar-chart" color={color} />,
        }}
      />
    </Tabs>
  );
}
