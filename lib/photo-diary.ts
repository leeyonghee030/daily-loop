import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

// 'routines_memo': 루틴을 실시간 연동 칩이 아니라 메모(text 블록)로 불러오는 모드 —
// 렌더링/편집은 'text' 블록과 완전히 같지만, 담지 않은 루틴 목록·복원 등 'routines'
// 전용 기능을 그대로 쓰기 위해 모드 자체는 구분해서 저장한다(app/photo-diary-form.tsx 참고)
export type PhotoDiaryMode = 'text' | 'routines' | 'routines_memo';
export type PhotoSource = 'camera' | 'library';
export type TextColorMode = 'black' | 'white' | 'accent';

// "루틴 고르기" 모드의 자유 캔버스 위 블록 하나 — 루틴이거나 사용자가 자유롭게 적는 메모.
// x/y는 사진 좌상단을 기준(0,0)으로 하는 캔버스 안에서의 절대 위치(px) — 사진 위에도 올릴 수 있다.
// pasted: 클립보드 붙여넣기로 추가됐는지(쌓임 순서 배치용). textColor: 전체 글자색 설정보다 우선하는 개별 글자색.
// photo 블록의 width/height: 가로/세로를 독립적으로 조절(자르기 효과)한 뒤의 실제 렌더링
// 크기(px, scale=1 기준 캔버스 좌표계). 아직 한 번도 조절 안 한 사진은 이 값이 없고, 그럴 땐
// scale(기존 균등 확대/축소 값)로부터 계산한 기본 크기를 쓴다 — app/photo-diary-form.tsx의
// photoBlockSize() 참고
// rotation: 기울기(도 단위, 시계방향 양수). 없으면 0(안 기울어짐). 사진은 전용 손잡이를
// 드래그해서, 루틴/메모는 선택 후 두 손가락으로 확대/축소하며 비틀어서 돌린다
// (app/photo-diary-form.tsx의 DraggableBlock 참고)
export type CanvasBlock =
  | {
      id: string;
      type: 'routine';
      routineId: string;
      x: number;
      y: number;
      scale?: number;
      rotation?: number;
      textColor?: TextColorMode;
    }
  | {
      id: string;
      type: 'text';
      text: string;
      x: number;
      y: number;
      scale?: number;
      rotation?: number;
      pasted?: boolean;
      textColor?: TextColorMode;
      // 'routines_memo' 모드에서 이 메모가 어떤 루틴에서 왔는지 — 있으면 "담지 않은 루틴"
      // 목록으로 숨기기/복원 대상이 된다(app/photo-diary-form.tsx의 hideRoutineBlock 참고)
      routineId?: string;
    }
  | {
      id: string;
      type: 'photo';
      uri: string;
      source: PhotoSource | null;
      // 옛날 디지털카메라 느낌(흐림+따뜻한 톤+테마색 틴트+비네트) 필터를 적용할지 — 인앱 카메라
      // 촬영 시 사용자가 직접 고른다. 없으면(예전 데이터) source==='camera'일 때만 자동 적용하던
      // 기존 규칙 그대로 따른다(app/photo-diary-form.tsx 렌더링 부분 참고)
      vintage?: boolean;
      x: number;
      y: number;
      scale?: number;
      width?: number;
      height?: number;
      // 더블탭으로 여는 "사진 위치 조정" 화면에서 고른, 원본 이미지 중 보여줄 사각형 영역 —
      // 전부 원본 이미지 가로/세로에 대한 0~1 정규화 비율(cropX,cropY: 좌상단 위치,
      // cropW,cropH: 크기). 없으면(한 번도 조정 안 함) 그냥 resizeMode="cover" 기본 동작.
      // 이 값이 있을 때 cropW:cropH는 반드시 이 사진 블록의 width:height와 같은 비율이어야
      // 왜곡 없이 렌더링된다 — 위치 조정 화면에서 크기(모양)를 바꾸면 width/height도 같이
      // 갱신되고, 캔버스에서 직접 모서리 손잡이로 모양을 바꾸면(aspect 변경) 반대로 이 값이
      // 초기화된다(app/photo-diary-form.tsx의 updateBlockSize/updateBlockCrop 참고)
      cropX?: number;
      cropY?: number;
      cropW?: number;
      cropH?: number;
      rotation?: number;
      pasted?: boolean;
    };

export type BackgroundType = 'none' | 'color' | 'photo';

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
  background_type: BackgroundType;
  background_color: string | null;
  background_photo_url: string | null;
  background_opacity: number;
  background_crop_x: number | null;
  background_crop_y: number | null;
  background_crop_w: number | null;
  background_crop_h: number | null;
  updated_at: string;
};

const SELECT_COLUMNS =
  'id, entry_date, photo_url, photo_source, mode, content, blocks, routine_color_enabled, text_color_mode, background_type, background_color, background_photo_url, background_opacity, background_crop_x, background_crop_y, background_crop_w, background_crop_h, updated_at';

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

// content(예전 일기적기용 큰 글상자)는 더 이상 쓰지 않음 — 일기적기도 blocks 기반 자유
// 캔버스로 통일됨(2026-09-15). DB 컬럼 자체는 예전 데이터 하위호환을 위해 남겨두되, 새로
// 저장할 땐 항상 null로 쓰고 blocks만 채운다
export type SavePhotoDiaryInput = {
  photoUrl: string;
  photoSource: PhotoSource | null;
  mode: PhotoDiaryMode;
  blocks: CanvasBlock[];
  routineColorEnabled: boolean;
  textColorMode: TextColorMode;
  backgroundType: BackgroundType;
  backgroundColor: string | null;
  backgroundPhotoUrl: string | null;
  backgroundOpacity: number;
  backgroundCropX: number | null;
  backgroundCropY: number | null;
  backgroundCropW: number | null;
  backgroundCropH: number | null;
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
    content: null,
    blocks: input.blocks,
    routine_color_enabled: input.routineColorEnabled,
    text_color_mode: input.textColorMode,
    background_type: input.backgroundType,
    background_color: input.backgroundColor,
    background_photo_url: input.backgroundPhotoUrl,
    background_opacity: input.backgroundOpacity,
    background_crop_x: input.backgroundCropX,
    background_crop_y: input.backgroundCropY,
    background_crop_w: input.backgroundCropW,
    background_crop_h: input.backgroundCropH,
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
