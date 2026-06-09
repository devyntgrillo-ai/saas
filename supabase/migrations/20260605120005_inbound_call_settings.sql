-- Two-way calling: when a patient calls the practice Twilio number back, ring
-- the browser (Twilio Client) and/or forward to a staff mobile number.
alter table public.practices
  add column if not exists inbound_call_forward_phone text,
  add column if not exists inbound_call_ring_browser boolean not null default true;
