// 디자인 목업(2026-09-02, 타투 라인워크 컨셉) 기반 공용 디자인 토큰.
// 화면마다 색상을 직접 하드코딩해온 기존 관례는 유지하되, 새 팔레트/폰트/모서리 값은 여기서 가져와 쓴다.
// 숫자/영문 라벨에만 아래 폰트를 쓰고, 한글 본문은 시스템 기본 폰트를 그대로 쓴다(사용자 확인, 2026-09-02).

export const accent = '#A9C4E0';
// 보조 포인트색 — 주색은 그대로 두고, 카드 테두리 바깥쪽에 한 겹 더 얇은 선을 주는 식의
// 절제된 포인트로만 쓴다(연회색)
export const accent2 = '#C6C9CE';

export const textMuted = '#8B8B85';
export const border = 'rgba(26,26,26,0.12)';
export const borderSubtle = 'rgba(26,26,26,0.08)';
export const panelBackground = '#F5F5F4';

// 깔끔한 느낌은 유지하되 글자 끝을 둥글린 폰트로 바꿔 부드러운 인상을 살짝 더함(2026-09, Bricolage Grotesque → Quicksand)
export const fontDisplay = 'Quicksand_700Bold';
export const fontDisplayBold = 'Quicksand_600SemiBold';
export const fontMono = 'SpaceMono_400Regular';
export const fontMonoBold = 'SpaceMono_700Bold';

// Quicksand/Space Mono는 한글을 지원 안 해서(라틴 전용) 한글 텍스트에 쓰면 그냥 시스템 폰트로
// 대체됨 — 사용자가 직접 적는 루틴 제목처럼 한글로 된 부분을 동글동글하게 하고 싶을 때 이 폰트를 쓴다.
// Jua(두껍고 간판느낌) → Gowun Dodum(세로로 긴 느낌) → Hi Melody(너무 유치함) 순으로
// 시도하다 Cute Font로 최종 정착함(2026-09) — 얇은 손글씨풍 둥근 폰트
export const fontKorean = 'CuteFont_400Regular';

// 카드/버튼 모서리 — 각진 느낌은 유지하되 아이폰 카드처럼 아주 살짝만 둥글게(필/원형 요소는 기존처럼 999 또는 '50%' 유지)
export const cardRadius = 6;

// 카드 그림자 — 처음엔 선명하고 각진 느낌으로 blur를 작게 잡았는데, 좀 더 아래로 넓고
// 연하게 퍼지는 느낌으로 조정함(오프셋/블러는 키우고 opacity는 낮춤)
export const cardShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.15,
  shadowRadius: 8,
  elevation: 5,
};

// 작은 텍스트(버튼 라벨 등)용 muted red — statusMissed는 캘린더 큰 면적용으로 연하게 뺀 색이라
// 글자에 쓰면 너무 흐려서, 어느 정도 채도를 살린 별도 톤을 둠
export const dangerMuted = '#D07272';

// 캘린더 날짜 상태색(다 완료/일부 완료/필수 놓침) — 채도 낮춘 파스텔 톤으로 통일해 주 색과 어울리게 함.
// 처음엔 원색을 살짝만 낮췄는데 여전히 탁해 보인다는 피드백으로 한 번 더 밝고 연하게 조정함
export const statusDone = '#B7D9C4';
export const statusPartial = '#EFD3A6';
export const statusMissed = '#E8B8B8';

// 월간뷰처럼 상태색이 큰 면적(동그라미)으로 보이는 자리에서 은은하게 쓰기 위한 헬퍼 —
// alpha를 낮춰 흰 배경에 옅게 비치는 톤으로 만든다
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
