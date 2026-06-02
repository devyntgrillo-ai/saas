-- A2P 10DLC + Twilio provisioning columns per practice (tenant).

alter table public.practices add column if not exists a2p_brand_status text not null default 'unregistered';
alter table public.practices add column if not exists a2p_campaign_status text not null default 'unregistered';
alter table public.practices add column if not exists twilio_brand_sid text;
alter table public.practices add column if not exists twilio_campaign_sid text;
alter table public.practices add column if not exists twilio_messaging_service_sid text;
alter table public.practices add column if not exists twilio_phone_sid text;
alter table public.practices add column if not exists a2p_config jsonb not null default '{}'::jsonb;
alter table public.practices add column if not exists a2p_submitted_at timestamptz;
alter table public.practices add column if not exists a2p_failure_reason text;

alter table public.practices drop constraint if exists practices_a2p_brand_status_check;
alter table public.practices add constraint practices_a2p_brand_status_check
  check (a2p_brand_status in ('unregistered', 'pending', 'approved', 'failed'));

alter table public.practices drop constraint if exists practices_a2p_campaign_status_check;
alter table public.practices add constraint practices_a2p_campaign_status_check
  check (a2p_campaign_status in ('unregistered', 'pending', 'approved', 'failed'));

create index if not exists idx_practices_a2p_pending
  on public.practices (a2p_brand_status, a2p_campaign_status)
  where twilio_phone_number is not null;
