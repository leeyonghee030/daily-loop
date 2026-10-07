import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text, View } from '@/components/Themed';
import { border, cardRadius, textMuted } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useAuth } from '@/lib/auth-context';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useTranslation } from '@/lib/language';
import { fetchLlmQuota, parseRoutine, LlmUnavailableError, QuotaExceededError, type LlmQuota } from '@/lib/llm';
import { parseRoutineInput, type ParsedRoutineDraft } from '@/lib/parse-routine-input';
import { parseRoutineInputEn } from '@/lib/parse-routine-input-en';

type ErrorState = 'none' | 'quota' | 'error' | 'overloaded';

// 화면을 벗어났다 뒤로가기로 돌아와도 마지막 입력을 복원하기 위한 모듈 스코프 저장소
let persistedText = '';

// 루틴이 실제로 저장 완료됐을 때만 routine-form 쪽에서 호출 — 다음엔 빈 화면에서 새로 시작
export function clearPersistedLlmText() {
  persistedText = '';
}

// 파싱 초안을 routine-form 프리필 파라미터(문자열)로 변환
function draftToParams(draft: ParsedRoutineDraft): Record<string, string> {
  const params: Record<string, string> = {
    title: draft.title,
    repeatType: draft.repeatType,
    blockType: draft.blockType,
    isRequired: draft.isRequired ? 'true' : 'false',
  };
  if (draft.repeatDays && draft.repeatDays.length > 0) params.repeatDays = draft.repeatDays.join(',');
  if (draft.scheduledDate) params.scheduledDate = draft.scheduledDate;
  if (draft.scheduledTime) params.scheduledTime = draft.scheduledTime;
  if (draft.slotType) params.slotType = draft.slotType;
  if (draft.trackingUnit) params.trackingUnit = draft.trackingUnit;
  return params;
}

export default function LlmInputScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  // 오늘 탭과 같은 쿼리 키를 써서 캐시를 공유한다
  const llmQuotaQueryKey = ['llm-quota', userId] as const;
  const [text, setText] = useState(persistedText);
  const [loadingMode, setLoadingMode] = useState<'none' | 'auto' | 'ai'>('none');
  const isLoading = loadingMode !== 'none';
  const [errorState, setErrorState] = useState<ErrorState>('none');

  const quotaQuery = useQuery({
    queryKey: llmQuotaQueryKey,
    queryFn: fetchLlmQuota,
    enabled: !!userId,
  });
  const quota = quotaQuery.data ?? null;

  useEffect(() => {
    persistedText = text;
  }, [text]);

  // 이 화면이 진짜로 스택에서 제거될 때만(뒤로가기로 완전히 나갈 때) 초안을 지운다.
  // routine-form을 미리보기로 push할 땐 이 화면이 제거되는 게 아니라 그대로 남아있어서 여기엔 안 걸림.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      clearPersistedLlmText();
    });
    return unsubscribe;
  }, [navigation]);

  async function handleSubmit(forceLlm = false) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setLoadingMode(forceLlm ? 'ai' : 'auto');
    // 여기서 미리 setErrorState('none')으로 지웠다가 실패하면 다시 채워 넣던 게, "다시 시도"를
    // 누르면 안내 박스가 사라졌다 나타났다 깜빡이는 것처럼 보이는 원인이었다(2026-09-27) —
    // 성공하면 화면을 아예 벗어나고(router.push) 실패하면 catch에서 알맞은 상태로 바꿔주므로,
    // 미리 지울 필요 없이 그대로 두면 같은 실패가 반복돼도 박스가 안 끊기고 계속 떠 있는다
    try {
      const result = await parseRoutine(trimmed, forceLlm, language);
      if (result.source === 'llm' && result.quotaRemaining !== undefined) {
        queryClient.setQueryData(llmQuotaQueryKey, (prev?: LlmQuota | null) =>
          prev ? { ...prev, remaining: result.quotaRemaining!, used: prev.limit - result.quotaRemaining! } : prev
        );
      }
      // 미리보기 화면에서 뒤로가기로 돌아와도 방금 쓴 문장이 남아있도록 여기서는 지우지 않는다.
      // replace가 아니라 push라서, 뒤로가기하면 (오늘 탭이 아니라) 이 입력 화면으로 돌아온다.
      // 미리보기 = routine-form을 프리필해서 재사용 (기획 4-8 ③ / 4-9)
      router.push({ pathname: '/routine-form', params: draftToParams(result.draft) });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        setErrorState('quota');
      } else if (err instanceof LlmUnavailableError) {
        setErrorState('overloaded');
      } else {
        setErrorState('error');
      }
    } finally {
      setLoadingMode('none');
    }
  }

  function goManualAdd() {
    router.replace('/routine-form');
  }

  // "규칙으로 진행"을 누른 "그 순간"의 입력창 내용으로 다시 계산한다 — 예전엔 AI 강제 호출이
  // 실패한 시점에 미리 계산해둔 정규식 결과(err.regexDraft)를 그대로 썼는데, 안내창이 떠 있는
  // 동안에도 입력창은 계속 수정 가능해서(editable이 안 막혀있음) 그 사이 문장을 고치고 눌러도
  // 고치기 전 문장 기준으로 만들어지는 버그가 있었다(2026-10-07)
  function useRegexDraftInstead() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const draft = language === 'en' ? parseRoutineInputEn(trimmed) : parseRoutineInput(trimmed);
    router.push({ pathname: '/routine-form', params: draftToParams(draft) });
  }

  // 한도 소진 상태 (4-13 요금제 안내)
  if (errorState === 'quota') {
    return (
      <View style={styles.container}>
        <View style={styles.centerBox}>
          <Ionicons name="sparkles-outline" size={40} color={textMuted} />
          <Text style={styles.quotaTitle}>{t('llmInput.quotaTitle')}</Text>
          <Text style={styles.quotaBody}>{t('llmInput.quotaBody')}</Text>
          <AnimatedPressable style={styles.primaryButton} onPress={() => setErrorState('none')}>
            <Text style={styles.primaryButtonText}>{t('llmInput.tryPlainAgain')}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.secondaryButton} onPress={goManualAdd}>
            <Text style={styles.secondaryButtonText}>{t('llmInput.addManually')}</Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {quota && (
        <Text style={styles.quotaCount}>
          {t('llmInput.remainingQuotaPrefix')}
          {quota.remaining}/{quota.limit}
          {t('llmInput.remainingQuotaSuffix')}
        </Text>
      )}

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={t('llmInput.placeholder')}
        placeholderTextColor="#aaa"
        multiline
        autoFocus
        maxLength={100}
        editable={!isLoading}
      />

      <Text style={styles.charCount}>{text.length}/100</Text>

      <View style={styles.hintRow}>
        <Ionicons name="bulb-outline" size={13} color={textMuted} style={styles.hintIcon} />
        <Text style={styles.hint}>{t('llmInput.hint')}</Text>
      </View>

      {errorState === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('llmInput.errorBody')}</Text>
          <View style={styles.errorButtons}>
            <AnimatedPressable style={styles.errorPrimaryButton} onPress={goManualAdd}>
              <Text style={styles.errorPrimaryButtonText}>{t('llmInput.addManually')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.secondaryButton} onPress={() => handleSubmit()} disabled={isLoading}>
              <Text style={styles.secondaryButtonText}>{t('llmInput.retry')}</Text>
            </AnimatedPressable>
          </View>
        </View>
      )}

      {/* "AI로 정확하게 분석"을 직접 눌렀는데 사용자가 몰려서 실패한 경우 전용 안내(2026-09-27) —
          위 일반 에러(errorState==='error')와 달리 "다시 시도"(같은 AI 재요청)와 "규칙 기반으로
          진행"(이미 계산해둔 정규식 결과를 그대로 씀) 두 선택지를 준다 */}
      {errorState === 'overloaded' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('llmInput.overloadedBody')}</Text>
          <View style={styles.errorButtons}>
            <AnimatedPressable style={styles.errorPrimaryButton} onPress={useRegexDraftInstead}>
              <Text style={styles.errorPrimaryButtonText}>{t('llmInput.useRegexInstead')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.secondaryButton} onPress={() => handleSubmit(true)}>
              <Text style={styles.secondaryButtonText}>{t('llmInput.retry')}</Text>
            </AnimatedPressable>
          </View>
        </View>
      )}

      <AnimatedPressable
        style={[styles.primaryButton, (!text.trim() || isLoading) && styles.primaryButtonDisabled]}
        onPress={() => handleSubmit()}
        disabled={!text.trim() || isLoading}>
        {loadingMode === 'auto' ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.primaryButtonText}>{t('llmInput.analyzing')}</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>{t('llmInput.previewButton')}</Text>
        )}
      </AnimatedPressable>

      <AnimatedPressable
        style={[styles.aiButton, (!text.trim() || isLoading) && styles.primaryButtonDisabled]}
        onPress={() => handleSubmit(true)}
        disabled={!text.trim() || isLoading}>
        {loadingMode === 'ai' ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={accent} />
            <Text style={styles.aiButtonText}>{t('llmInput.aiAnalyzing')}</Text>
          </View>
        ) : (
          <View style={styles.loadingRow}>
            <Ionicons name="sparkles-outline" size={14} color={accent} />
            <Text style={styles.aiButtonText}>{t('llmInput.aiAnalyzeButton')}</Text>
          </View>
        )}
      </AnimatedPressable>
    </View>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  quotaCount: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 12,
    textAlign: 'right',
  },
  input: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    padding: 14,
    fontSize: 16 + fontKorean.sizeAdjust,
    lineHeight: 21 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 6,
    textAlign: 'right',
  },
  hintRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 12,
  },
  hintIcon: {
    marginTop: 2,
  },
  hint: {
    flex: 1,
    fontSize: 12,
    opacity: 0.55,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  aiButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 12,
    alignItems: 'center',
  },
  aiButtonText: {
    color: accent,
    fontSize: 14,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'transparent',
  },
  quotaTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  quotaBody: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  // 이 안내(errorBox)는 처음엔 어두운/빨간 배경이었는데, 앱의 다른 안내문(설정 화면
  // 회원탈퇴 안내, FAB 안내 등)과 통일해서 흰 배경+주색 테두리, 글자는 무채색으로 바꿨다
  // (2026-09-27) — 어떤 테마색을 고르든 대비가 안정적으로 확보된다
  errorBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: cardRadius,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: accent,
    gap: 12,
  },
  errorText: {
    color: '#222',
    fontSize: 14 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
    lineHeight: 20,
  },
  errorButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'transparent',
  },
  // errorButtons가 flexDirection만 row이고 alignItems 지정이 없으면 기본값(stretch)이 적용돼
  // 두 버튼이 서로 다른 높이로 늘어나고, 그 안의 글자는 위쪽에 붙어 세로 중심이 안 맞아
  // 보였다(2026-09-27) — 버튼 자체에 center 정렬을 명시해서 높이가 달라도 글자가 항상
  // 버튼 한가운데 오게 한다
  errorPrimaryButton: {
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 18,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPrimaryButtonText: {
    color: '#fff',
    fontFamily: fontKorean.fontFamily,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: accent,
    fontWeight: '600',
  },
  });
}
