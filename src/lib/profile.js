// Current-user profile: display name + avatar + role, shown app-wide.
import { supabase } from './supabase'

// Preset "Your Role" options. Anything else is stored as free text via "Other".
export const ROLE_OPTIONS = ['Dentist', 'Office Manager', 'Treatment Coordinator', 'Marketing Personnel']

// Upload an avatar to the public `avatars` bucket (under the user's own folder)
// and return its public URL.
export async function uploadAvatar(userId, file) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase()
  const path = `${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { contentType: file.type || undefined, upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

// Persist the display name + avatar. Writes the public.users row via a safe RPC
// (only these two fields) and mirrors to auth user_metadata so anything reading
// user_metadata (chat sender/presence, etc.) stays in sync.
export async function updateMyProfile({ displayName, avatarUrl, jobTitle }) {
  let { error } = await supabase.rpc('update_my_profile', {
    p_display_name: displayName ?? null,
    p_avatar_url: avatarUrl ?? null,
    p_job_title: jobTitle ?? null,
  })
  // Back-compat: if the job_title migration hasn't run yet, the 3-arg function
  // doesn't exist — fall back to the 2-arg version so name/avatar still save.
  if (error && (error.code === 'PGRST202' || /update_my_profile|function/i.test(error.message || ''))) {
    ;({ error } = await supabase.rpc('update_my_profile', {
      p_display_name: displayName ?? null,
      p_avatar_url: avatarUrl ?? null,
    }))
  }
  if (error) throw error
  await supabase.auth
    .updateUser({ data: { full_name: displayName || null, avatar_url: avatarUrl || null } })
    .catch(() => {})
}
