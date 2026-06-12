import { supabase } from '@/lib/supabase';

export async function invokeEdgeFunction(name: string, body: Record<string, unknown>) {
  const { data, error, response } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    if (response && typeof response.json === 'function') {
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        /* use default */
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
