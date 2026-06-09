import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

const adminTrainingKey = [...queryKeys.admin.training(), 'page']

export function usePatchTrainingLesson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('training_modules').update(patch).eq('id', id)
      if (error) throw error
      return { id, patch }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTrainingKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() })
    },
  })
}

export function useReorderTrainingLessons() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ lessonId, swapLessonId, orderA, orderB }) => {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('training_modules').update({ order_index: orderB }).eq('id', lessonId),
        supabase.from('training_modules').update({ order_index: orderA }).eq('id', swapLessonId),
      ])
      if (e1) throw e1
      if (e2) throw e2
      return { lessonId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTrainingKey })
    },
  })
}

export function useDeleteTrainingLesson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('training_modules').delete().eq('id', id)
      if (error) throw error
      return { id }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTrainingKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() })
    },
  })
}

export function useSaveTrainingLesson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ form }) => {
      const payload = {
        title: form.title.trim(),
        module_group: form.module_group,
        description: form.description,
        duration: (Number(form.durationMin) || 0) * 60,
        video_url: form.video_url.trim() || null,
        category: form.category,
        status: form.status,
        order_index: Number(form.order_index) || 0,
      }
      if (form.id) {
        const { error } = await supabase.from('training_modules').update(payload).eq('id', form.id)
        if (error) throw error
        return { id: form.id, created: false, payload }
      }
      const { data, error } = await supabase.from('training_modules').insert(payload).select().single()
      if (error) throw error
      return { id: data.id, created: true, row: data }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTrainingKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() })
    },
  })
}

export function usePushTrainingLessons() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ pushedBy, count }) => {
      const { error: e1 } = await supabase
        .from('training_modules')
        .update({ status: 'published' })
        .in('status', ['draft', 'updated'])
      if (e1) throw e1
      await supabase.from('training_push_log').insert({
        pushed_by: pushedBy,
        lessons_pushed: count,
        notes: null,
      })
      return { count }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTrainingKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() })
    },
  })
}
