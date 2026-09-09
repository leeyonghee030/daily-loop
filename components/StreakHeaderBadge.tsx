import { useQuery } from '@tanstack/react-query';

import { DottedStreakRing } from '@/components/DottedStreakRing';
import { useAuth } from '@/lib/auth-context';
import { fetchStats } from '@/lib/routines';

// 오늘/캘린더/통계 탭 헤더의 빈 자리(설정 아이콘 왼쪽)를 채우는 작은 장식.
// 역대 최고 스트릭이 있으면 점묘 링 도형만(숫자 없이) 은은하게 보여준다 — 이미 오늘 탭이
// 백그라운드로 미리 받아둔 stats 캐시를 그대로 재사용해서 별도 네트워크 요청은 없다.
export function StreakHeaderBadge() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const statsQuery = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => fetchStats(userId!),
    enabled: !!userId,
  });

  const bestStreak = statsQuery.data?.bestStreakEver ?? 0;
  if (bestStreak <= 0) return null;

  return <DottedStreakRing size={22} dotCount={10} />;
}
