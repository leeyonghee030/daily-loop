import { useRef, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, panelBackground, statusDone, statusMissed, statusPartial, withAlpha } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont } from '@/lib/korean-font';
import { useTranslation, type TranslationKey } from '@/lib/language';
import { useOnboarding } from '@/lib/onboarding';

const SCREEN_WIDTH = Dimensions.get('window').width;
// 실제 탭 화면 스크린샷 대신, 그 화면의 배치를 그대로 흉내 낸 작은 가짜 화면(목업)을 코드로
// 그린다 — 글로만 설명하니 "어디를 말하는 건지" 와닿지 않는다는 피드백(2026-09-27)으로,
// 아이콘 나열 대신 각 슬라이드가 설명하는 실제 화면 구조(체크박스/트래킹 입력/FAB 위성메뉴/
// 캘린더 그리드 등)를 알아볼 수 있는 축소판으로 교체
const MOCK_WIDTH = Math.min(240, SCREEN_WIDTH - 96);

// 온보딩(테마색/폰트/언어 고르기) 바로 다음, 오늘 탭으로 들어가기 전에 한 번 보여주는 짧은
// 기능 소개 — 처음 쓰는 사람이 체크형/트래킹형 차이나 + 버튼 용도 같은 걸 각 화면 안내문을
// 일일이 펼쳐봐야만 알 수 있던 문제를 줄이기 위해 신설(2026-09-27)
const SLIDE_KEYS: { titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { titleKey: 'featureTour.slide1Title', bodyKey: 'featureTour.slide1Body' },
  { titleKey: 'featureTour.slide2Title', bodyKey: 'featureTour.slide2Body' },
  { titleKey: 'featureTour.slide3Title', bodyKey: 'featureTour.slide3Body' },
  { titleKey: 'featureTour.slide4Title', bodyKey: 'featureTour.slide4Body' },
];

function MockFrame({
  styles,
  width = MOCK_WIDTH,
  children,
}: {
  styles: ReturnType<typeof createStyles>;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.mockFrame, { width }]}>
      <View style={styles.mockFrameNotch} />
      {children}
    </View>
  );
}

// 슬라이드1 — 체크형(체크박스)/트래킹형(숫자 입력)/시각체크(그 순간만) 차이를 오늘 탭 리스트
// 행 3개로 보여준다
function MockCheckTypes({ accent, styles }: { accent: string; styles: ReturnType<typeof createStyles> }) {
  const { t } = useTranslation();
  return (
    <MockFrame styles={styles}>
      <View style={styles.mockRow}>
        <Text style={styles.mockTime}>07:00</Text>
        <Text style={styles.mockTitle} numberOfLines={1}>
          {t('featureTour.mockDrinkWater')}
        </Text>
        <View style={styles.mockCheckbox} />
      </View>
      <View style={styles.mockRow}>
        <Text style={styles.mockTime}>07:30</Text>
        <Text style={styles.mockTitle} numberOfLines={1}>
          {t('featureTour.mockPushups')}
        </Text>
        <View style={[styles.mockTrackingBox, { borderColor: accent }]}>
          <Text style={[styles.mockTrackingValue, { color: accent }]}>12</Text>
        </View>
        <Text style={styles.mockUnit}>{t('featureTour.mockPushupsUnit')}</Text>
      </View>
      <View style={styles.mockRow}>
        <Ionicons name="timer-outline" size={13} color={accent} style={styles.mockInstantIcon} />
        <Text style={styles.mockTitle} numberOfLines={1}>
          {t('featureTour.mockWakeUp')}
        </Text>
        <View style={[styles.mockCheckbox, styles.mockCheckboxDone, { backgroundColor: accent, borderColor: accent }]}>
          <Ionicons name="checkmark" size={11} color="#fff" />
        </View>
      </View>
    </MockFrame>
  );
}

// 슬라이드2 — 오른쪽 아래 + 버튼을 누르면 위성 3개(카테고리/말로 루틴 추가하기/루틴 추가)가
// 펼쳐지는 실제 오늘 탭 구조를 그대로 축소해서 보여준다
function MockFabMenu({ accent, styles }: { accent: string; styles: ReturnType<typeof createStyles> }) {
  const { t } = useTranslation();
  return (
    <MockFrame styles={styles}>
      <View style={styles.mockFabArea}>
        {/* 실제 오늘 탭 FAB 위성 순서(위→아래): 루틴 추가 → 말로 루틴 추가하기 → 카테고리(FAB
            바로 위) — 목업도 똑같은 순서로 맞춘다(2026-09-27) */}
        <View style={[styles.mockSatellitePill, { borderColor: accent }]}>
          <Ionicons name="add-outline" size={11} color={accent} />
          <Text style={[styles.mockSatelliteText, { color: accent }]}>{t('featureTour.mockAddRoutine')}</Text>
        </View>
        <View style={[styles.mockSatellitePill, { borderColor: accent }]}>
          <Ionicons name="mic-outline" size={11} color={accent} />
          <Text style={[styles.mockSatelliteText, { color: accent }]}>{t('today.llmBanner')}</Text>
        </View>
        <View style={[styles.mockSatellitePill, { borderColor: accent }]}>
          <Ionicons name="grid-outline" size={11} color={accent} />
          <Text style={[styles.mockSatelliteText, { color: accent }]}>{t('today.category')}</Text>
        </View>
        <View style={[styles.mockFabCircle, { backgroundColor: accent }]}>
          <Ionicons name="add" size={20} color="#fff" />
        </View>
      </View>
    </MockFrame>
  );
}

// 슬라이드3 — 같은 하루 일정을 목록(체크박스 나열)과 타임라인(시간축+블록)으로 각각 보여준다
function MockListVsTimeline({ accent, styles }: { accent: string; styles: ReturnType<typeof createStyles> }) {
  const { t } = useTranslation();
  const halfWidth = (MOCK_WIDTH - 12) / 2;
  return (
    <View style={styles.mockSideBySide}>
      <MockFrame styles={styles} width={halfWidth}>
        <Text style={styles.mockMiniLabel}>{t('today.list')}</Text>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.mockThinRow}>
            <View style={[styles.mockThinDot, i === 1 && { backgroundColor: accent, borderColor: accent }]} />
            <View style={styles.mockThinLine} />
          </View>
        ))}
      </MockFrame>
      <MockFrame styles={styles} width={halfWidth}>
        <Text style={styles.mockMiniLabel}>{t('today.timeline')}</Text>
        <View style={styles.mockTimelineAxis}>
          <View style={[styles.mockTimelineBlock, { top: 4, height: 14, backgroundColor: withAlpha(accent, 0.18) }]} />
          <View style={[styles.mockTimelineBlock, { top: 26, height: 22, backgroundColor: withAlpha(accent, 0.3) }]} />
          <View style={[styles.mockTimelineNowLine, { top: 56, backgroundColor: accent }]} />
          <View style={[styles.mockTimelineBlock, { top: 66, height: 14, backgroundColor: withAlpha(accent, 0.18) }]} />
        </View>
      </MockFrame>
    </View>
  );
}

// 슬라이드4 — 캘린더 월간 그리드(완료 상태 점)와 통계 막대그래프를 나란히 축소해서 보여준다
function MockCalendarStats({ accent, styles }: { accent: string; styles: ReturnType<typeof createStyles> }) {
  const { t } = useTranslation();
  const halfWidth = (MOCK_WIDTH - 12) / 2;
  const dotColors = [statusDone, statusDone, statusPartial, statusDone, statusMissed, statusDone, statusDone, statusPartial, statusDone];
  return (
    <View style={styles.mockSideBySide}>
      <MockFrame styles={styles} width={halfWidth}>
        <Text style={styles.mockMiniLabel}>{t('nav.tabCalendar')}</Text>
        <View style={styles.mockCalendarGrid}>
          {dotColors.map((color, i) => (
            <View key={i} style={[styles.mockCalendarDot, { backgroundColor: color }]} />
          ))}
        </View>
      </MockFrame>
      <MockFrame styles={styles} width={halfWidth}>
        <Text style={styles.mockMiniLabel}>{t('nav.tabStats')}</Text>
        <View style={styles.mockBarRow}>
          <View style={[styles.mockBar, { height: 18, backgroundColor: withAlpha(accent, 0.3) }]} />
          <View style={[styles.mockBar, { height: 34, backgroundColor: withAlpha(accent, 0.5) }]} />
          <View style={[styles.mockBar, { height: 24, backgroundColor: withAlpha(accent, 0.35) }]} />
          <View style={[styles.mockBar, { height: 40, backgroundColor: accent }]} />
        </View>
      </MockFrame>
    </View>
  );
}

export default function FeatureTourScreen() {
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t } = useTranslation();
  const { markSeen } = useOnboarding();
  // "다음"/"시작" 버튼이 안드로이드 하단 내비게이션 바에 가려지는 문제(edgeToEdgeEnabled로
  // 기기마다 내비바 높이가 달라 고정 숫자로는 못 챙김 — 이 세션에서 여러 번 겪은 것과 같은
  // 원인, 2026-10-07) — 기기의 실제 안전영역 값을 읽어 하단 여백에 더해준다
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const styles = createStyles(accent, koreanFont.fontFamily);
  const isLast = index === SLIDE_KEYS.length - 1;

  const mockups = [
    <MockCheckTypes key="check-types" accent={accent} styles={styles} />,
    <MockFabMenu key="fab-menu" accent={accent} styles={styles} />,
    <MockListVsTimeline key="list-timeline" accent={accent} styles={styles} />,
    <MockCalendarStats key="calendar-stats" accent={accent} styles={styles} />,
  ];

  // 오늘 탭으로의 이동은 여기서 직접 하지 않는다 — markSeen() 완료(=onboarding_completed가
  // true로 바뀜) 직후 이 화면이 스스로 router.replace('/(tabs)')를 부르면, 그 세션/온보딩
  // 상태 변경이 app/_layout.tsx까지 리렌더로 전파되기 *전에* 이 이동이 먼저 반영되는 경쟁이
  // 생겨서 "시작하기를 두 번 눌러야 넘어가는" 버그로 이어졌다(2026-10-07, adb logcat으로
  // 확인). onboardingSeen이 true로 바뀌는 걸 감지해 _layout.tsx가 직접 오늘 탭으로 보내도록
  // 일원화해서 이 경쟁 자체를 없앴다
  async function finish() {
    await markSeen();
  }

  function goNext() {
    if (isLast) {
      finish();
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * SCREEN_WIDTH, animated: true });
  }

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
  }

  return (
    <View style={[styles.container, { paddingBottom: 40 + insets.bottom }]}>
      <AnimatedPressable style={styles.skipButton} onPress={finish} hitSlop={8}>
        <Text style={styles.skipButtonText}>{t('featureTour.skip')}</Text>
      </AnimatedPressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}>
        {SLIDE_KEYS.map((slide, slideIndex) => (
          <View key={slideIndex} style={styles.slide}>
            {mockups[slideIndex]}
            <Text style={styles.slideTitle}>{t(slide.titleKey)}</Text>
            <Text style={styles.slideBody}>{t(slide.bodyKey)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dotsRow}>
        {SLIDE_KEYS.map((_, dotIndex) => (
          <View key={dotIndex} style={[styles.dot, dotIndex === index && styles.dotActive]} />
        ))}
      </View>

      <AnimatedPressable style={styles.nextButton} onPress={goNext}>
        <Text style={styles.nextButtonText}>{isLast ? t('featureTour.start') : t('featureTour.next')}</Text>
      </AnimatedPressable>
    </View>
  );
}

function createStyles(accent: string, fontFamily: string | undefined) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    skipButton: {
      position: 'absolute',
      top: 60,
      right: 24,
      zIndex: 1,
      padding: 8,
    },
    skipButtonText: {
      fontSize: 14,
      opacity: 0.5,
      fontFamily,
    },
    slide: {
      width: SCREEN_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    slideTitle: {
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 28,
      marginBottom: 12,
      fontFamily,
    },
    slideBody: {
      fontSize: 14,
      lineHeight: 21,
      opacity: 0.6,
      textAlign: 'center',
      fontFamily,
    },
    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 24,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(0,0,0,0.15)',
    },
    dotActive: {
      backgroundColor: accent,
      width: 16,
    },
    nextButton: {
      marginHorizontal: 24,
      backgroundColor: accent,
      borderRadius: cardRadius,
      paddingVertical: 16,
      alignItems: 'center',
    },
    nextButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },

    // ── 목업 공용 ──
    mockSideBySide: {
      flexDirection: 'row',
      gap: 12,
    },
    mockFrame: {
      height: 132,
      borderRadius: cardRadius + 4,
      borderWidth: 1,
      borderColor: border,
      backgroundColor: '#fff',
      padding: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 3,
    },
    // 화면 느낌을 주는 작은 노치(상단 카메라 홀 흉내) — 이게 "실제 폰 화면"이라는 인상을 준다
    mockFrameNotch: {
      alignSelf: 'center',
      width: 28,
      height: 4,
      borderRadius: 2,
      backgroundColor: border,
      marginBottom: 8,
    },
    mockMiniLabel: {
      fontSize: 10,
      opacity: 0.4,
      marginBottom: 6,
      textAlign: 'center',
    },

    // 슬라이드1 — 체크/트래킹/시각체크 목록 행
    mockRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
    },
    mockTime: {
      fontSize: 10,
      opacity: 0.4,
      width: 32,
    },
    mockInstantIcon: {
      width: 32,
    },
    mockTitle: {
      fontSize: 12,
      flex: 1,
    },
    mockCheckbox: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: border,
    },
    mockCheckboxDone: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    mockTrackingBox: {
      width: 24,
      height: 16,
      borderRadius: 4,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mockTrackingValue: {
      fontSize: 10,
      fontWeight: '700',
    },
    mockUnit: {
      fontSize: 10,
      opacity: 0.5,
    },

    // 슬라이드2 — FAB 위성 메뉴
    mockFabArea: {
      flex: 1,
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      gap: 6,
    },
    mockSatellitePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      backgroundColor: '#fff',
    },
    mockSatelliteText: {
      fontSize: 9,
      fontWeight: '600',
    },
    mockFabCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },

    // 슬라이드3 — 리스트/타임라인
    mockThinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 5,
    },
    mockThinDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: border,
    },
    mockThinLine: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: panelBackground,
    },
    mockTimelineAxis: {
      flex: 1,
      position: 'relative',
      borderLeftWidth: 1,
      borderLeftColor: border,
      marginLeft: 4,
    },
    mockTimelineBlock: {
      position: 'absolute',
      left: 6,
      right: 0,
      borderRadius: 3,
    },
    mockTimelineNowLine: {
      position: 'absolute',
      left: -1,
      right: 0,
      height: 2,
      borderRadius: 1,
    },

    // 슬라이드4 — 캘린더/통계
    mockCalendarGrid: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignContent: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    mockCalendarDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    mockBarRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 8,
    },
    mockBar: {
      width: 14,
      borderRadius: 3,
    },
  });
}
