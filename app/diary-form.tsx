import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 내용이 짧아 화면을 안 채울 때도 드래그 제스처가 스크롤로 인식되도록 확보하는 여백 높이
const SCROLL_SPACER_HEIGHT = Math.round(Dimensions.get('window').height * 0.8);

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ShadowCard } from '@/components/ShadowCard';
import { Text, View } from '@/components/Themed';
import { useToast } from '@/components/Toast';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useAuth } from '@/lib/auth-context';
import { useTranslation, type Language } from '@/lib/language';
import { deleteDiary, fetchDiary, saveDiary } from '@/lib/diary';
import { fetchPhotoDiary } from '@/lib/photo-diary';

const EN_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDateLabel(dateStr: string, language: Language, titleSuffix: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (language === 'en') return `${titleSuffix} — ${EN_MONTH_NAMES[m - 1]} ${d}, ${y}`;
  return `${y}년 ${m}월 ${d}일 ${titleSuffix}`;
}

export default function DiaryFormScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);
  const { show: showToast, toastNode } = useToast();

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const photoDiaryQuery = useQuery({
    queryKey: ['photo-diary', userId, date],
    queryFn: () => fetchPhotoDiary(userId!, date),
    enabled: !!userId && !!date,
  });

  const diaryQuery = useQuery({
    queryKey: ['diary', userId, date],
    queryFn: () => fetchDiary(userId!, date),
    enabled: !!userId && !!date,
  });
  const isLoading = diaryQuery.isLoading;

  useEffect(() => {
    const diary = diaryQuery.data;
    if (!diary) return;
    setDiaryId(diary.id);
    setContent(diary.content);
  }, [diaryQuery.data]);

  useEffect(() => {
    if (diaryQuery.isError) setErrorMessage(t('diary.errorLoad'));
  }, [diaryQuery.isError]);

  async function handleSave() {
    if (!userId || !date) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const saved = await saveDiary(userId, date, content, diaryId);
      // 서버 저장 직후 이 화면을 다시 열면(같은 날짜) 캐시에 남은 예전 값을 먼저 보여주고
      // 나중에야 새로고침되는 문제가 있었음 — 응답을 바로 캐시에 반영해서 다음에 열 때부터
      // 곧장 최신 내용이 보이게 한다(2026-09-17)
      queryClient.setQueryData(['diary', userId, date], saved);
      // 신규 작성이었으면 이제부터는 "수정"이 되도록 id를 반영(다음 저장이 새 글 등록이 아니라
      // 덮어쓰기가 되어야 함) — 저장하자마자 화면을 나가버리던 걸 "저장됐다고 알려주고 사용자가
      // 직접 나가게" 바꾸면서 같은 화면에서 또 저장할 수 있게 됐기 때문에 필요해짐(2026-09-17)
      setDiaryId(saved.id);
      setIsSaving(false);
      Keyboard.dismiss();
      showToast(t('diary.savedToast'), accent);
    } catch (err) {
      setErrorMessage(t('diary.errorSave'));
      setIsSaving(false);
    }
  }

  function handleDelete() {
    setShowDeleteConfirm(true);
  }

  async function performDelete() {
    setShowDeleteConfirm(false);
    if (!diaryId || !userId || !date) return;
    setIsSaving(true);
    try {
      await deleteDiary(diaryId);
      // 삭제 직후 같은 날짜 일기를 다시 열면 캐시에 남은 지워지기 전 내용이 잠깐(때로는
      // 한참) 남아있던 버그 — 삭제 성공 즉시 캐시를 비워서 바로 "일기 없음" 상태로 만든다
      queryClient.setQueryData(['diary', userId, date], null);
      router.back();
    } catch (err) {
      setErrorMessage(t('diary.errorDelete'));
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {toastNode}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}>
          <Text style={styles.title}>{formatDateLabel(date, language, t('diary.titleSuffix'))}</Text>

          <TextInput
            style={styles.textArea}
            value={content}
            onChangeText={setContent}
            placeholder={t('diary.placeholder')}
            multiline
            textAlignVertical="top"
          />

          {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

          <AnimatedPressable
            style={styles.photoDiaryButton}
            onPress={() => router.push({ pathname: '/photo-diary-form', params: { date } })}>
            <Ionicons name="camera-outline" size={16} color={accent} />
            <Text style={styles.photoDiaryButtonText}>
              {photoDiaryQuery.data ? t('photoDiary.viewButton') : t('photoDiary.createButton')}
            </Text>
          </AnimatedPressable>

          <AnimatedPressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.saveButtonText}>{t('today.save')}</Text>
              </>
            )}
          </AnimatedPressable>

          {diaryId && (
            <AnimatedPressable style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
              <Text style={styles.deleteButtonText}>{t('diary.deleteButton')}</Text>
            </AnimatedPressable>
          )}

          <View style={{ height: SCROLL_SPACER_HEIGHT }} />
        </ScrollView>
      </TouchableWithoutFeedback>

      <Modal visible={showDeleteConfirm} transparent animationType="fade" onRequestClose={() => setShowDeleteConfirm(false)}>
        <RNView style={styles.confirmBackdrop}>
          <AnimatedPressable style={StyleSheet.absoluteFill} onPress={() => setShowDeleteConfirm(false)} />
          <ShadowCard style={styles.confirmCardOuter} contentStyle={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t('diary.deleteConfirmTitle')}</Text>
            <Text style={styles.confirmDesc}>{t('diary.deleteConfirmDesc')}</Text>
            <View style={styles.confirmButtonRow}>
              <AnimatedPressable style={styles.confirmCancelButton} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={styles.confirmCancelText}>{t('settings.cancel')}</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.confirmDeleteButton} onPress={performDelete}>
                <Text style={styles.confirmDeleteText}>{t('myRoutines.delete')}</Text>
              </AnimatedPressable>
            </View>
          </ShadowCard>
        </RNView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function createStyles(accent: string, fontKorean: KoreanFontValue) {
  return StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexGrow: 1,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  textArea: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: border,
    borderRadius: cardRadius,
    padding: 14,
    fontSize: 15 + fontKorean.sizeAdjust,
    lineHeight: 22 + fontKorean.sizeAdjust,
    fontFamily: fontKorean.fontFamily,
  },
  error: {
    color: '#FF6B6B',
    marginTop: 12,
  },
  photoDiaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    borderWidth: 1,
    borderColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 12,
  },
  photoDiaryButtonText: {
    color: accent,
    fontSize: 14,
    fontWeight: '600',
  },
  // 삭제 버튼이 다른 화면들(모음집/내 루틴/오늘탭)과 같은 주색 꽉 채움이라, 체크 아이콘만
  // 더해서는 여전히 둘이 비슷해 보인다는 피드백 — 아예 꽉 채움(저장) vs 테두리만(삭제)로
  // 채움 방식 자체를 다르게 해서 한눈에 구분되게 한다(2026-09-17)
  saveButton: {
    marginTop: 12,
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // 저장은 큰 버튼으로 확실히 강조하고, 삭제는 버튼 틀 없이 작은 텍스트 링크로만 둬서 두
  // 동작의 무게감이 한눈에 다르게 보이게 한다(2026-09-17)
  deleteButton: {
    marginTop: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: accent,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 32,
  },
  confirmCardOuter: {
    width: '100%',
  },
  confirmCard: {
    padding: 24,
    alignItems: 'center',
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 18,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmCancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: border,
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.6,
  },
  confirmDeleteButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: cardRadius,
    backgroundColor: accent,
  },
  confirmDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  });
}
