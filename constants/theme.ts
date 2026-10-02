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
// 시도하다 Cute Font로 최종 정착함(2026-09) — 얇은 손글씨풍 둥근 폰트(한글+라틴 모두 지원)
export const fontKorean = 'CuteFont_400Regular';

// 앱 언어가 영어일 때 쓰는 "동글 폰트" — Cute Font는 한글에 맞춰 고른 손글씨풍이라 라틴 글자만
// 두고 보면 어색해서, 영어 전용으로 더 무난하게 둥근 Fredoka를 따로 쓴다(2026-09).
// SemiBold→Medium도 여전히 두꺼워 보인다는 피드백으로 한 단계 더 얇은 Regular로 낮춤
export const fontEnglishRounded = 'Fredoka_400Regular';

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

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 타임라인 "지금" 강조처럼, 사용자가 고른 테마색과 같은 색감은 유지한 채 눈에 띄게 진하고
// 채도 높은 버전이 필요할 때 쓴다 — 예전엔 이 자리에 테마색과 무관한 고정 주황을 써서,
// 어떤 테마색을 고르든 "지금" 표시만 따로 튀어 보인다는 피드백이 있었다(2026-10-02).
// 색상(hue)은 그대로 두고 채도/명도만 끌어올려서 "같은 색의 더 쨍한 버전"으로 보이게 한다.
// 0.62/0.48 → 0.5/0.56 → 0.42/0.64 → 0.36/0.7로 계속 완화함(노랑/로즈/세이지 전부 "아직
// 진하다"는 재확인이 반복돼서 — 그래도 "차이는 있을 정도로"는 유지).
// 무채색(검정 테마 등, 채도가 거의 0)은 HSL 변환에서 색상각(h)이 의미 없이 0(=빨강)으로 나와서
// 검정 테마를 고르면 "지금" 강조가 빨간색으로 보이는 버그가 있었음 — 색 자체는 안 입히고
// 명도만 더 짙은 회색으로 눌러서 해결했는데, 처음엔 min(l, lightTarget)으로 해서 원래
// 명도가 이미 lightTarget보다 낮은 검정 테마(#4A4A4A)는 그대로 통과돼 "지금"과 "평소"가
// 똑같아 보이는(=강조 자체가 안 보이는) 버그가 또 있었음 — 원래 명도보다 항상 고정폭만큼
// 더 어둡게 눌러서 구별되게 고쳤고, 그 폭도 "검정은 연한 색도 더 연하게" 요청으로 0.15→0.1→0.06→0.04로 계속 완화.
// 색 있는 테마 중 핑크(로즈)만 다른 색보다 유독 진하게 느껴진다는 재확인(2026-10-02)이 있었음 —
// HSL의 명도(L)는 사람이 느끼는 실제 밝기와 정확히 비례하지 않아서, 빨강/분홍처럼 초록 성분이
// 적은 색상은 노랑/초록 계열과 같은 L이어도 실제로는 더 어둡게 보인다(sRGB 상대 휘도 공식 참고).
// 매번 색상(hue)마다 보정값을 따로 손으로 맞추는 대신, 실제 휘도를 재서 목표치보다 낮으면
// 명도를 조금씩 더 올려 어떤 색상이든 비슷한 정도로 은은하게 보이도록 자동 보정한다.
// 그래도 핑크가 더 연하고 은은해야 한다는 재확인으로 목표 휘도를 0.62→0.68→0.74로,
// 채도 기준도 0.36→0.3으로 한 번 더 낮춤. 초록(세이지)도 연하게 해달라는 요청이 반복돼서
// 기본 명도(lightTarget)를 0.7→0.76→0.82로 계속 올림(루프로 저휘도 색만 더 올리던 것과
// 별개로, 모든 색의 "출발 명도" 자체를 더 밝게)
export function intensify(hex: string, satTarget = 0.3, lightTarget = 0.82): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.05) return hslToHex(0, 0, Math.max(0, l - 0.04));
  let result = hslToHex(h, Math.max(s, satTarget), lightTarget);
  const targetLuminance = 0.74;
  let extraLight = 0;
  while (relativeLuminance(result) < targetLuminance && lightTarget + extraLight < 0.9) {
    extraLight += 0.03;
    result = hslToHex(h, Math.max(s, satTarget), lightTarget + extraLight);
  }
  return result;
}

// 반투명(rgba) 배경을 쓰면 스와이프 닫힘 애니메이션 중 그 뒤로 슬라이드되어 빠져나가는
// 버튼 색이 비쳐 보이는 문제가 있어서(2026-09-21), "흰 배경 위에 그 반투명색을 얹었을 때와
// 눈으로 똑같이 보이는" 불투명(opaque) 색을 직접 계산해 대신 쓸 때 쓰는 헬퍼. 예전엔 이 계산을
// 고정 테마색(#A9C4E0) 기준으로 손으로 미리 구해서 하드코딩해둬서, 사용자가 다른 테마색을
// 고르면 이 자리만 색이 안 바뀌는 버그가 있었다(2026-10-02) — 어떤 accent를 넣어도 그때그때
// 계산되도록 함수로 뺐다
export function blendOverWhite(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const blend = (channel: number) => Math.round(255 * (1 - alpha) + channel * alpha);
  const r = blend(parseInt(clean.substring(0, 2), 16));
  const g = blend(parseInt(clean.substring(2, 4), 16));
  const b = blend(parseInt(clean.substring(4, 6), 16));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// blendOverWhite와 같은 alpha를 줘도, 무채색(검정 테마 등)은 RGB 값 자체가 파스텔 테마색들보다
// 훨씬 흰색에서 멀어서(예: #4A4A4A는 R=74인데 파스텔들은 보통 200대) 훨씬 더 진하게 비친다 —
// 검정 테마의 타임라인 평소 블록 배경이 다른 테마보다 유독 진하다는 피드백(2026-10-02)의 원인.
// 무채색일 때만 alpha를 절반으로 줄여서 다른 테마와 비슷한 정도로 은은하게 맞춘다
export function blendOverWhiteSubtle(hex: string, alpha: number): string {
  const { s } = hexToHsl(hex);
  return blendOverWhite(hex, s < 0.05 ? alpha * 0.5 : alpha);
}
