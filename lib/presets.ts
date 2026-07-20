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
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
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
  const { error } = await supabase.from('routine_presets').delete().eq('id', presetId);
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
  }));

  const { error } = await supabase.from('routines').insert(routines);
  if (error) throw error;
  return routines.length;
}
