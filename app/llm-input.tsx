import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { fetchLlmQuota, parseRoutine, QuotaExceededError, type LlmQuota } from '@/lib/llm';
import type { ParsedRoutineDraft } from '@/lib/parse-routine-input';

type ErrorState = 'none' | 'quota' | 'error';

// 파싱 초안을 routine-form 프리필 파라미터(문자열)로 변환
function draftToParams(draft: ParsedRoutineDraft): Record<string, string> {
  const params: Record<string, string> = {
    title: draft.title,
    repeatType: draft.repeatType,
    blockType: draft.blockType,
    isRequired: draft.isRequired ? 'true' : 'false',
  };
  if (draft.repeatDays && draft.repeatDays.length > 0) params.repeatDays = draft.repeatDays.join(',');
  if (draft.scheduledTime) params.scheduledTime = draft.scheduledTime;
  if (draft.trackingUnit) params.trackingUnit = draft.trackingUnit;
  return params;
}

export default function LlmInputScreen() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorState, setErrorState] = useState<ErrorState>('none');
  const [quota, setQuota] = useState<LlmQuota | null>(null);

  useEffect(() => {
    fetchLlmQuota().then(setQuota).catch(() => {});
  }, []);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setIsLoading(true);
    setErrorState('none');
    try {
      const result = await parseRoutine(trimmed);
      // 미리보기 = routine-form을 프리필해서 재사용 (기획 4-8 ③ / 4-9)
      router.replace({ pathname: '/routine-form', params: draftToParams(result.draft) });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        setErrorState('quota');
      } else {
        setErrorState('error');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function goManualAdd() {
    router.replace('/routine-form');
  }

  // 한도 소진 상태 (4-13 요금제 안내)
  if (errorState === 'quota') {
    return (
      <View style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.bigEmoji}>✨</Text>
          <Text style={styles.quotaTitle}>무료 AI 배치 횟수를 모두 사용했어요</Text>
          <Text style={styles.quotaBody}>
            요금제는 곧 출시돼요, 조금만 기다려주세요! 루틴은 직접 추가할 수 있어요.
          </Text>
          <Pressable style={styles.primaryButton} onPress={goManualAdd}>
            <Text style={styles.primaryButtonText}>직접 추가하기 →</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {quota && (
        <Text style={styles.quotaCount}>
          남은 AI 배치 {quota.remaining}/{quota.limit}회
        </Text>
      )}

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="예: 매일 아침 7시에 물 8잔 마시기"
        placeholderTextColor="#aaa"
        multiline
        autoFocus
        maxLength={100}
        editable={!isLoading}
      />

      <Text style={styles.charCount}>{text.length}/100</Text>

      <Text style={styles.hint}>
        💡 이런 걸 넣으면 더 정확해요 — 언제(매일·평일·월수금) · 몇 시(아침 7시) · 꼭 할 것(꼭·반드시) ·
        횟수(물 8잔·30분)
      </Text>

      {errorState === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            지금은 AI 배치가 잠시 쉬고 있어요. 복구까지 시간이 걸릴 수 있으니, 지금은 직접
            추가하는 걸 추천해요.
          </Text>
          <View style={styles.errorButtons}>
            <Pressable style={styles.errorPrimaryButton} onPress={goManualAdd}>
              <Text style={styles.errorPrimaryButtonText}>직접 추가하기</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handleSubmit}>
              <Text style={styles.secondaryButtonText}>다시 시도</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable
        style={[styles.primaryButton, (!text.trim() || isLoading) && styles.primaryButtonDisabled]}
        onPress={handleSubmit}
        disabled={!text.trim() || isLoading}>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.primaryButtonText}>AI가 분석 중...</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>미리보기 만들기</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
  bigEmoji: {
    fontSize: 40,
  },
  quotaCount: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 12,
    textAlign: 'right',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 6,
    textAlign: 'right',
  },
  hint: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 12,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: '#7C5CFC',
    borderRadius: 10,
    paddingVertical: 14,
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
  errorBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.1)',
    gap: 12,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
    lineHeight: 20,
  },
  errorButtons: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
  },
  errorPrimaryButton: {
    backgroundColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  errorPrimaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#7C5CFC',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#7C5CFC',
    fontWeight: '600',
  },
});
