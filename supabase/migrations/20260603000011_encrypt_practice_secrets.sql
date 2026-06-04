-- ============================================================================
-- Encrypt sensitive practice keys at rest using pgcrypto (audit finding 4).
--
-- ghl_api_key and doxyme_api_key are encrypted via pgp_sym_encrypt with a
-- key stored in the PostgreSQL config parameter `app.encryption_key`. The key
-- is NOT exposed through PostgREST — only service_role edge functions can
-- decrypt via the helper functions below.
--
-- IMPORTANT: Override `app.encryption_key` in production by running:
--   alter database postgres set app.encryption_key = '<64-char-hex>';
--   select pg_reload_conf();
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.encrypt_secret(p_plaintext text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select encode(
    extensions.pgp_sym_encrypt(
      p_plaintext,
      current_setting('app.encryption_key', true)
    ),
    'base64'
  )
$$;

create or replace function public.decrypt_secret(p_ciphertext text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.pgp_sym_decrypt(
    decode(p_ciphertext, 'base64'),
    current_setting('app.encryption_key', true)
  )::text
$$;

-- Function to resolve a practice by its (encrypted) doxyme_api_key.
-- Returns the practice_id if a match is found.
create or replace function public.match_doxyme_key(p_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  decrypted text;
begin
  for rec in select id, doxyme_api_key from public.practices where doxyme_api_key is not null loop
    begin
      decrypted := public.decrypt_secret(rec.doxyme_api_key);
      if decrypted = p_key then
        return rec.id;
      end if;
    exception when others then
      -- If decryption fails, the value might be plaintext (legacy) — compare directly.
      if rec.doxyme_api_key = p_key then
        return rec.id;
      end if;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.encrypt_secret(text) from public, anon;
revoke all on function public.decrypt_secret(text) from public, anon;
revoke all on function public.match_doxyme_key(text) from public, anon;
grant execute on function public.encrypt_secret(text) to authenticated, service_role;
grant execute on function public.decrypt_secret(text) to authenticated, service_role;
grant execute on function public.match_doxyme_key(text) to service_role;

-- ── Auto-encrypt trigger for doxyme_api_key ──────────────────────────────────
-- Skips values that are already base64-encoded ciphertext to avoid double
-- encryption.

create or replace function public.auto_encrypt_practice_secrets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.doxyme_api_key is not null and not new.doxyme_api_key ~ '^[A-Za-z0-9+/=]{40,}$' then
    new.doxyme_api_key := public.encrypt_secret(new.doxyme_api_key);
  end if;
  if new.ghl_api_key is not null and not new.ghl_api_key ~ '^[A-Za-z0-9+/=]{40,}$' then
    new.ghl_api_key := public.encrypt_secret(new.ghl_api_key);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_encrypt_practice_secrets on public.practices;
create trigger trg_auto_encrypt_practice_secrets
  before insert or update
  on public.practices
  for each row
  execute function public.auto_encrypt_practice_secrets();

-- ── Encrypt any existing plaintext values ────────────────────────────────────
update public.practices
  set doxyme_api_key = public.encrypt_secret(doxyme_api_key)
  where doxyme_api_key is not null
    and doxyme_api_key !~ '^[A-Za-z0-9+/=]{40,}$';

update public.practices
  set ghl_api_key = public.encrypt_secret(ghl_api_key)
  where ghl_api_key is not null
    and ghl_api_key !~ '^[A-Za-z0-9+/=]{40,}$';
