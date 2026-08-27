import { supabase } from '@/lib/supabase';
import type { BlockType } from '@/lib/routines';

export type FavoriteInput = {
  title: string;
  block_type: BlockType;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  is_instant: boolean;
  slot_id: string | null;
  is_required: boolean;
  tracking_unit: string | null;
};

export type Favorite = FavoriteInput & {
  id: string;
  user_id: string;
};

export async function fetchFavorites(userId: string): Promise<Favorite[]> {
  const { data, error } = await supabase
    .from('routine_favorites')
    .select('*')
    .eq('user_id', userId)
    .order('title', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchFavoriteById(favoriteId: string): Promise<Favorite> {
  const { data, error } = await supabase
    .from('routine_favorites')
    .select('*')
    .eq('id', favoriteId)
    .single();
  if (error) throw error;
  return data;
}

export async function createFavorite(userId: string, input: FavoriteInput): Promise<Favorite> {
  const { data, error } = await supabase
    .from('routine_favorites')
    .insert({ user_id: userId, ...input })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFavorite(favoriteId: string, input: FavoriteInput): Promise<Favorite> {
  const { data, error } = await supabase
    .from('routine_favorites')
    .update(input)
    .eq('id', favoriteId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFavorite(favoriteId: string): Promise<void> {
  const { error } = await supabase.from('routine_favorites').delete().eq('id', favoriteId);
  if (error) throw error;
}
