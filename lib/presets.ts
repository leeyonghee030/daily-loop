import { supabase } from '@/lib/supabase';
import type { BlockType, RepeatType } from '@/lib/routines';

export type PresetItemInput = {
  title: string;
  block_type: BlockType;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
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

export async function applyPreset(userId: string, presetId: string): Promise<number> {
  const { preset, items } = await fetchPresetWithItems(presetId);
  if (items.length === 0) return 0;

  const routines = items.map((item) => ({
    user_id: userId,
    title: item.title,
    block_type: item.block_type,
    repeat_type: preset.repeat_type,
    repeat_days: preset.repeat_type === 'custom' ? preset.repeat_days : null,
    scheduled_time_start: item.scheduled_time_start,
    scheduled_time_end: item.scheduled_time_end,
    scheduled_date: null,
    slot_id: item.slot_id,
    is_required: item.is_required,
    tracking_unit: item.tracking_unit,
    skip_holidays: preset.skip_holidays,
    preset_id: presetId,
  }));

  const { error } = await supabase.from('routines').insert(routines);
  if (error) throw error;
  return routines.length;
}
