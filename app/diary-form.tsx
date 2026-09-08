import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
} from 'react-native';

// 내용이 짧아 화면을 안 채울 때도 드래그 제스처가 스크롤로 인식되도록 확보하는 여백 높이
const SCROLL_SPACER_HEIGHT = Math.round(Dimensions.get('window').height * 0.8);

import { AnimatedPressable } from '@/components/AnimatedPressable';
import { Text, View } from '@/components/Themed';
import { border, cardRadius } from '@/constants/theme';
import { useAccentColor } from '@/lib/accent-color';
import { useKoreanFont, type KoreanFontValue } from '@/lib/korean-font';
import { useAuth } from '@/lib/auth-context';
import { useTranslation, type Language } from '@/lib/language';
import { deleteDiary, fetchDiary, saveDiary } from '@/lib/diary';

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
  const { session } = useAuth();
  const userId = session?.user.id;
  const accent = useAccentColor();
  const koreanFont = useKoreanFont();
  const { t, language } = useTranslation();
  const styles = useMemo(() => createStyles(accent, koreanFont), [accent, koreanFont]);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState<string | null>(null);
  const [content, setContent] = useState('');

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
      await saveDiary(userId, date, content, diaryId);
      router.back();
    } catch (err) {
      setErrorMessage(t('diary.errorSave'));
      setIsSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert(t('diary.deleteConfirmTitle'), t('diary.deleteConfirmDesc'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('myRoutines.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!diaryId) return;
          setIsSaving(true);
          try {
            await deleteDiary(diaryId);
            router.back();
          } catch (err) {
            setErrorMessage(t('diary.errorDelete'));
            setIsSaving(false);
          }
        },
      },
    ]);
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

          <AnimatedPressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
            {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{t('today.save')}</Text>}
          </AnimatedPressable>

          {diaryId && (
            <AnimatedPressable style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
              <Text style={styles.deleteButtonText}>{t('diary.deleteButton')}</Text>
            </AnimatedPressable>
          )}

          <View style={{ height: SCROLL_SPACER_HEIGHT }} />
        </ScrollView>
      </TouchableWithoutFeedback>
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
  saveButton: {
    marginTop: 16,
    backgroundColor: accent,
    borderRadius: cardRadius,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FF6B6B',
    borderRadius: cardRadius,
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  });
}
