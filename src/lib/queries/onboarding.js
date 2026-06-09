import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export function useSaveOnboardingPatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, patch }) => {
      const { error } = await supabase.from('practices').update(patch).eq('id', practiceId)
      if (error) throw error
      return { practiceId, patch }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function usePersistOnboardingStep() {
  return useMutation({
    mutationFn: async ({ practiceId, step }) => {
      const { error } = await supabase.from('practices').update({ onboarding_step: step }).eq('id', practiceId)
      if (error) throw error
      return { practiceId, step }
    },
  })
}

export function useCreateOnboardingAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      signUp, email, password, practiceName, phone, contactName, heardFrom, planAmount, refCode, referrerPracticeId, parentPracticeId,
    }) => {
      const { data, error: signUpError } = await signUp(email, password, { practice_name: practiceName })
      if (signUpError) throw signUpError
      if (!data.session || !data.user) {
        throw new Error('Please confirm your email, then sign in to continue. (Email confirmation is enabled on this project.)')
      }
      const parts = (contactName || '').trim().split(/\s+/)
      const doctor_first = parts[0] || ''
      const doctor_last = parts.slice(1).join(' ') || ''
      const { data: created, error: practiceError } = await supabase
        .from('practices')
        .insert({
          name: practiceName,
          email,
          phone,
          doctor_first,
          doctor_last,
          heard_from: heardFrom || null,
          plan_amount: planAmount,
          ...(refCode ? { referred_by_code: refCode } : {}),
          ...(referrerPracticeId ? { referred_by_practice_id: referrerPracticeId } : {}),
        })
        .select('id')
        .single()
      if (practiceError) throw practiceError
      const { error: linkError } = await supabase.from('users').update({ practice_id: created.id }).eq('id', data.user.id)
      if (linkError) throw linkError
      if (parentPracticeId) {
        try {
          await supabase.functions.invoke('link-location', {
            body: { parent_practice_id: parentPracticeId, new_practice_id: created.id },
          })
        } catch { /* non-blocking */ }
      }
      return { practiceId: created.id, userId: data.user.id }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function useOnboardingTeamInvite() {
  return useMutation({
    mutationFn: async ({ practiceId, email, role }) => {
      const { error } = await supabase.functions.invoke('invite-team-member', {
        body: {
          practice_id: practiceId,
          email,
          role,
          access_level: role === 'admin' ? 'practice_admin' : 'practice_member',
          app_origin: window.location.origin,
        },
      })
      if (error) throw error
      return { email }
    },
  })
}
