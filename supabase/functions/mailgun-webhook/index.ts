// mailgun-webhook — inbound email replies (Mailgun Routes) + open tracking.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const json = (b, s = 200)=>new Response(JSON.stringify(b), {
    status: s,
    headers: {
      'Content-Type': 'application/json'
    }
  });
function stripQuoted(t) {
  return (t || '').split(/\n>|-----Original Message-----|On .* wrote:/)[0].trim();
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok');
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const form = await req.formData();
    const evt = String(form.get('event') || '');
    // Open tracking event.
    if (evt === 'opened') {
      const mid = String(form.get('message-id') || form.get('Message-Id') || '');
      if (mid) await admin.from('message_logs').update({
        status: 'opened'
      }).eq('mailgun_message_id', mid);
      return json({
        ok: true
      });
    }
    // Inbound reply.
    const recipient = String(form.get('recipient') || form.get('To') || '');
    const sender = String(form.get('sender') || form.get('from') || '');
    const bodyPlain = stripQuoted(String(form.get('stripped-text') || form.get('body-plain') || ''));
    const digits = recipient.toLowerCase();
    const { data: practices } = await admin.from('practices').select('id, email_from_address, mailgun_domain');
    const practice = (practices || []).find((p)=>p.email_from_address && digits.includes(p.email_from_address.toLowerCase()) || p.mailgun_domain && digits.includes(p.mailgun_domain.toLowerCase()));
    if (!practice) return json({
      ok: false,
      reason: 'no practice match'
    });
    const emailOnly = (sender.match(/<(.+?)>/)?.[1] || sender).trim();
    let { data: conv } = await admin.from('conversations').select('id, consult_id').eq('practice_id', practice.id).eq('patient_email', emailOnly).maybeSingle();
    if (!conv) {
      const ins = await admin.from('conversations').insert({
        practice_id: practice.id,
        patient_email: emailOnly,
        last_message_at: new Date().toISOString(),
        unread_count: 1
      }).select('id, consult_id').single();
      conv = ins.data;
    }
    const now = new Date().toISOString();
    const { data: cm } = await admin.from('conversation_messages').insert({
      conversation_id: conv.id,
      direction: 'inbound',
      channel: 'email',
      body: bodyPlain,
      sent_at: now
    }).select('id').single();
    await admin.from('conversations').update({
      last_message_at: now,
      unread_count: 1
    }).eq('id', conv.id);
    await admin.from('message_logs').insert({
      practice_id: practice.id,
      conversation_message_id: cm?.id,
      direction: 'inbound',
      channel: 'email',
      status: 'received'
    });
    if (conv.consult_id) await admin.from('consults').update({
      status: 'replied'
    }).eq('id', conv.consult_id);
    await admin.from('notifications').insert({
      practice_id: practice.id,
      type: 'patient_replied',
      title: 'Patient replied by email',
      message: bodyPlain.slice(0, 120),
      link: `/conversations?c=${conv.id}`
    });
    return json({
      ok: true
    });
  } catch (e) {
    return json({
      error: String(e?.message || e)
    });
  }
});
