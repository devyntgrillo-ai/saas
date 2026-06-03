/**
 * Finish signup when auth exists but public.users.practice_id is still null
 * (common when email confirmation is required before the first session).
 */
export async function ensurePracticeLinked(supabase, user) {
  if (!user?.id) return { practiceId: null, error: null }

  const practiceName = user.user_metadata?.practice_name?.trim()
  if (!practiceName) return { practiceId: null, error: null }

  const { data: existing, error: userError } = await supabase
    .from('users')
    .select('practice_id')
    .eq('id', user.id)
    .maybeSingle()

  if (userError) return { practiceId: null, error: userError }
  if (existing?.practice_id) return { practiceId: existing.practice_id, error: null }

  const email = user.email?.trim()
  if (email) {
    const { data: byEmail, error: lookupError } = await supabase
      .from('practices')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (lookupError) return { practiceId: null, error: lookupError }
    if (byEmail?.id) {
      const { error: linkError } = await supabase
        .from('users')
        .update({ practice_id: byEmail.id })
        .eq('id', user.id)
      return { practiceId: byEmail.id, error: linkError }
    }
  }

  const { data: created, error: practiceError } = await supabase
    .from('practices')
    .insert({ name: practiceName, email: email || null })
    .select('id')
    .single()

  if (practiceError) return { practiceId: null, error: practiceError }

  const { error: linkError } = await supabase
    .from('users')
    .update({ practice_id: created.id })
    .eq('id', user.id)

  return { practiceId: created.id, error: linkError }
}
