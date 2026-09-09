import { useQuery } from '@tanstack/react-query';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { Text, View } from '@/components/Themed';
import { textMuted } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from '@/lib/language';
import { emojiForStreak, fetchStats, fetchStreakConfigs } from '@/lib/routines';
import { StyleSheet } from 'react-native';

// 오늘/캘린더/통계 탭 헤더의 빈 자리(설정 아이콘 왼쪽)를 채우는 작은 장식.
// 역대 최고 스트릭(지금까지 있었던 모든 루틴 통틀어)을 로고와 같은 톤의 미니 링 + 은은한
// 텍스트로 보여준다 — 이미 오늘 탭이 백그라운드로 미리 받아둔 stats 캐시를 그대로 재사용해서
// (같은 쿼리 키) 별도 네트워크 요청은 발생하지 않는다.
const SIZE = 18;
const STROKE_WIDTH = 3;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_RATIO = 270 / 360;

export function StreakHeaderBadge() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { t } = useTranslation();

  const statsQuery = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => fetchStats(userId!),
    enabled: !!userId,
  });
  const configsQuery = useQuery({
    queryKey: ['streak-configs'],
    queryFn: fetchStreakConfigs,
    staleTime: 60 * 60 * 1000,
  });

  const bestStreak = statsQuery.data?.bestStreakEver ?? 0;
  const emoji = emojiForStreak(bestStreak, configsQuery.data ?? []);

  // 아직 스트릭이 없는 신규 계정은 빈 자리를 그대로 비워둔다(0일을 굳이 안 보여줌)
  if (!emoji || bestStreak <= 0) return null;

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        <Defs>
          <LinearGradient id="headerStreakGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#3E6A9C" />
            <Stop offset="100%" stopColor="#FF7F66" />
          </LinearGradient>
        </Defs>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke="url(#headerStreakGrad)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * ARC_RATIO} ${CIRCUMFERENCE}`}
          fill="none"
        />
      </Svg>
      <Text style={styles.text}>
        {emoji} {bestStreak}
        {t('today.daySuffix')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  text: {
    fontSize: 12,
    opacity: 0.6,
    color: textMuted,
  },
});
