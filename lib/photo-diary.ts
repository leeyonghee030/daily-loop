import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

export type PhotoDiaryMode = 'text' | 'routines';
export type PhotoSource = 'camera' | 'library';
export type TextColorMode = 'black' | 'white' | 'accent';

// "루틴 고르기" 모드의 자유 캔버스 위 블록 하나 — 루틴이거나 사용자가 자유롭게 적는 메모.
// x/y는 사진 좌상단을 기준(0,0)으로 하는 캔버스 안에서의 절대 위치(px) — 사진 위에도 올릴 수 있다.
export type CanvasBlock =
  | { id: string; type: 'routine'; routineId: string; x: number; y: number; scale?: number }
  | { id: string; type: 'text'; text: string; x: number; y: number; scale?: number }
  | { id: string; type: 'photo'; uri: string; source: PhotoSource | null; x: number; y: number; scale?: number };

export type PhotoDiary = {
  id: string;
  entry_date: string;
  photo_url: string;
  photo_source: PhotoSource | null;
  mode: PhotoDiaryMode;
  content: string | null;
  blocks: CanvasBlock[] | null;
  routine_color_enabled: boolean;
  text_color_mode: TextColorMode;
  updated_at: string;
};

const SELECT_COLUMNS =
  'id, entry_date, photo_url, photo_source, mode, content, blocks, routine_color_enabled, text_color_mode, updated_at';

export async function fetchPhotoDiary(userId: string, date: string): Promise<PhotoDiary | null> {
  const { data, error } = await supabase
    .from('photo_diaries')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .eq('entry_date', date)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type SavePhotoDiaryInput = {
  photoUrl: string;
  photoSource: PhotoSource | null;
  mode: PhotoDiaryMode;
  content: string | null;
  blocks: CanvasBlock[] | null;
  routineColorEnabled: boolean;
  textColorMode: TextColorMode;
};

export async function savePhotoDiary(
  userId: string,
  date: string,
  input: SavePhotoDiaryInput,
  existingId: string | null
): Promise<PhotoDiary> {
  const row = {
    photo_url: input.photoUrl,
    photo_source: input.photoSource,
    mode: input.mode,
    content: input.mode === 'text' ? input.content : null,
    blocks: input.mode === 'routines' ? input.blocks : null,
    routine_color_enabled: input.routineColorEnabled,
    text_color_mode: input.textColorMode,
  };

  if (existingId) {
    const { data, error } = await supabase
      .from('photo_diaries')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', existingId)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('photo_diaries')
    .insert({ user_id: userId, entry_date: date, ...row })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

// 캘린더에 사진일기 작성 여부 표시용 — lib/diary.ts의 fetchDiaryDatesInRange와 동일 패턴
export async function fetchPhotoDiaryDatesInRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('photo_diaries')
    .select('entry_date')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('entry_date', startDate)
    .lte('entry_date', endDate);
  if (error) throw error;
  return (data ?? []).map((d) => d.entry_date);
}

export async function deletePhotoDiary(id: string): Promise<void> {
  const { error } = await supabase.from('photo_diaries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// routine-photos와 동일한 방식(base64 업로드) — 사진일기 전용 버킷에 저장
export async function uploadPhotoDiaryPhoto(userId: string, localUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('photo-diaries')
    .upload(path, decode(base64), { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from('photo-diaries').getPublicUrl(path);
  return data.publicUrl;
}
