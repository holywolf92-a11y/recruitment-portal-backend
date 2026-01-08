import { supabaseAdminClient } from '../config/database';

export async function getUserById(userId: string) {
  const db = supabaseAdminClient();
  const { data, error } = await db.from('users').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function getUserProfile(userId: string) {
  // Expand as needed (joins, role resolution)
  return getUserById(userId);
}
