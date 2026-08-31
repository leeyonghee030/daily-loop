import { supabase } from '@/lib/supabase';
import { pauseRoutinesByPreset, type BlockType, type RepeatType } from '@/lib/routines';

export type PresetItemInput = {
  title: string;
  block_type: BlockType;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  is_instant: boolean;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
};

export type PresetItem = PresetItemInput & {
  id: string;
  preset_id: string;
  sort_order: number;
};

export type RoutinePreset = {
  id: string;
  user_id: string;
  name: string;
  repeat_type: RepeatType;
  repeat_days: number[] | null;
  skip_holidays: boolean;
  deleted_at: string | null;
};

export type PresetInput = {
  name: string;
  repeat_type: RepeatType;
  repeat_days: number[] | null;
  skip_holidays: boolean;
};

export async function fetchPresets(userId: string): Promise<RoutinePreset[]> {
  const { data, error } = await supabase
    .from('routine_presets')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// "루틴 복구" 화면용 — 삭제된 모음집만
export async function fetchDeletedPresets(userId: string): Promise<RoutinePreset[]> {
  const { data, error } = await supabase
    .from('routine_presets')
    .select('*')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function restorePreset(presetId: string): Promise<void> {
  const { error } = await supabase.from('routine_presets').update({ deleted_at: null }).eq('id', presetId);
  if (error) throw error;
}

// "루틴 복구" 화면에서 사용자가 직접 골라 완전 삭제(2주를 안 기다리고 즉시)할 때 사용
export async function hardDeletePreset(presetId: string): Promise<void> {
  const { error } = await supabase.from('routine_presets').delete().eq('id', presetId);
  if (error) throw error;
}

// 삭제된 지 2주 지난 모음집을 완전히 지운다 — 앱 열 때 하루 한 번 조용히 실행되는 용도
export async function purgeOldDeletedPresets(userId: string): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const { error } = await supabase
    .from('routine_presets')
    .delete()
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff.toISOString());
  if (error) throw error;
}

export async function fetchPresetWithItems(
  presetId: string
): Promise<{ preset: RoutinePreset; items: PresetItem[] }> {
  const [{ data: preset, error: presetError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase.from('routine_presets').select('*').eq('id', presetId).single(),
      supabase
        .from('preset_items')
        .select('*')
        .eq('preset_id', presetId)
        .order('sort_order', { ascending: true }),
    ]);
  if (presetError) throw presetError;
  if (itemsError) throw itemsError;
  return { preset, items: items ?? [] };
}

export async function savePreset(
  userId: string,
  presetId: string | null,
  input: PresetInput,
  items: PresetItemInput[]
): Promise<string> {
  let id: string;

  if (presetId) {
    id = presetId;
    const { error } = await supabase.from('routine_presets').update(input).eq('id', id);
    if (error) throw error;
    const { error: deleteError } = await supabase
      .from('preset_items')
      .delete()
      .eq('preset_id', id);
    if (deleteError) throw deleteError;
  } else {
    const { data, error } = await supabase
      .from('routine_presets')
      .insert({ user_id: userId, ...input })
      .select('id')
      .single();
    if (error) throw error;
    id = data.id;
  }

  if (items.length > 0) {
    const { error: insertError } = await supabase.from('preset_items').insert(
      items.map((item, index) => ({ ...item, preset_id: id, sort_order: index }))
    );
    if (insertError) throw insertError;
  }

  return id;
}

export async function deletePreset(presetId: string): Promise<void> {
  const { error } = await supabase
    .from('routine_presets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', presetId);
  if (error) throw error;
}

function presetItemsToRoutines(userId: string, presetId: string, preset: RoutinePreset, items: PresetItemInput[]) {
  return items.map((item) => ({
    user_id: userId,
    title: item.title,
    block_type: item.block_type,
    repeat_type: preset.repeat_type,
    repeat_days: preset.repeat_type === 'custom' ? preset.repeat_days : null,
    scheduled_time_start: item.scheduled_time_start,
    scheduled_time_end: item.scheduled_time_end,
    is_instant: item.is_instant,
    scheduled_date: null,
    slot_id: item.slot_id,
    is_required: item.is_required,
    tracking_unit: item.tracking_unit,
    skip_holidays: preset.skip_holidays,
    preset_id: presetId,
  }));
}

// 이 모음집으로 이미 만들어진(삭제 안 된) 루틴이 있으면 새로 또 만들지 않고 일시정지만
// 풀어서 재사용한다 — 안 그러면 "전체 비활성화" 후 "적용"을 다시 누를 때마다 예전 루틴은
// 그대로 남아있는 채로 새 루틴이 또 생겨서 개수가 계속 불어나는 버그가 있었음(2개→4개).
export async function applyPreset(userId: string, presetId: string): Promise<number> {
  const { data: existing, error: existingError } = await supabase
    .from('routines')
    .select('id')
    .eq('preset_id', presetId)
    .is('deleted_at', null);
  if (existingError) throw existingError;

  if ((existing ?? []).length > 0) {
    await pauseRoutinesByPreset(presetId, false);
    return existing!.length;
  }

  const { preset, items } = await fetchPresetWithItems(presetId);
  if (items.length === 0) return 0;

  const routines = presetItemsToRoutines(userId, presetId, preset, items);
  const { error } = await supabase.from('routines').insert(routines);
  if (error) throw error;
  return routines.length;
}

function presetItemSignature(item: {
  title: string;
  block_type: BlockType;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  is_instant: boolean;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
}): string {
  return JSON.stringify([
    item.title,
    item.block_type,
    item.scheduled_time_start,
    item.scheduled_time_end,
    item.is_instant,
    item.slot_id,
    item.is_required,
    item.tracking_unit,
  ]);
}

// 모음집 수정 화면에서 "이미 적용돼 있던" 항목을 지우면, 그걸로 만들어진 실제 루틴도 같이
// 소프트삭제한다(사용자가 명시적으로 지운 항목에 한해서만 적용 — 필드만 살짝 바꾼 항목은
// 손대지 않음. 안 그러면 그 루틴에 쌓인 완료기록/스트릭이 의도치 않게 끊길 수 있어서).
// 같은 내용(제목/시간 등)의 항목이 여러 개면 그중 하나씩만 매칭해 지운다.
export async function removePresetItemRoutines(
  presetId: string,
  removedItems: PresetItemInput[]
): Promise<number> {
  if (removedItems.length === 0) return 0;
  const { data: existingRoutines, error } = await supabase
    .from('routines')
    .select('id, title, block_type, scheduled_time_start, scheduled_time_end, is_instant, slot_id, is_required, tracking_unit')
    .eq('preset_id', presetId)
    .is('deleted_at', null);
  if (error) throw error;

  const remaining = [...(existingRoutines ?? [])];
  const idsToDelete: string[] = [];
  for (const removedItem of removedItems) {
    const signature = presetItemSignature(removedItem);
    const matchIndex = remaining.findIndex((routine) => presetItemSignature(routine) === signature);
    if (matchIndex !== -1) {
      idsToDelete.push(remaining[matchIndex].id);
      remaining.splice(matchIndex, 1);
    }
  }
  if (idsToDelete.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from('routines')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', idsToDelete);
  if (deleteError) throw deleteError;
  return idsToDelete.length;
}

// 기존 모음집을 수정하면서 새로 추가한 항목만 오늘 목록에 실제 루틴으로 반영한다.
// (모음집 수정 자체는 템플릿만 바꾸고 이미 적용된 루틴은 건드리지 않는데, 그러면 새로 추가한
// 항목이 실제 루틴으로 안 생겨서 "내 루틴"에서 안 보이거나, 같은 이름 항목을 중복으로 추가해도
// 실물은 1개뿐이라 헷갈리는 문제가 있었음 — 방금 추가한 항목만 콕 집어 바로 적용해서 해결)
export async function applyNewPresetItems(
  userId: string,
  presetId: string,
  newItems: PresetItemInput[]
): Promise<number> {
  if (newItems.length === 0) return 0;
  const { data: preset, error: presetError } = await supabase
    .from('routine_presets')
    .select('*')
    .eq('id', presetId)
    .single();
  if (presetError) throw presetError;

  const routines = presetItemsToRoutines(userId, presetId, preset, newItems);
  const { error } = await supabase.from('routines').insert(routines);
  if (error) throw error;
  return routines.length;
}
