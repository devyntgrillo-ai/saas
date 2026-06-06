-- Enable Supabase Realtime on the consults table so the app can update Consults,
-- Sequences, and the Dashboard live when a consult transitions analyzing →
-- analyzed (processing cards flip to ready without a reload). Mirrors the
-- conversations realtime migration; idempotent. Also makes the pre-existing
-- useSequencesRealtime() consults subscription actually fire.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'consults'
  ) then
    alter publication supabase_realtime add table public.consults;
  end if;
end $$;

-- UPDATE payloads need full row data so filters (practice_id) and new.status
-- are present on the change event.
alter table public.consults replica identity full;
