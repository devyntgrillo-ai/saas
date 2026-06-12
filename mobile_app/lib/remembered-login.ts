import { deviceDeleteItem, deviceGetItem, deviceSetItem } from '@/lib/device-storage';

const KEY = 'caselift_remembered_login';
const LEGACY_EMAIL_KEY = 'kl_remembered_email';

export type RememberedLogin = {
  email: string;
  practiceName: string;
  displayName?: string;
};

export async function saveRememberedLogin(data: RememberedLogin): Promise<void> {
  const email = data.email.trim();
  const practiceName = data.practiceName.trim();
  if (!email || !practiceName) return;
  await deviceSetItem(
    KEY,
    JSON.stringify({
      email,
      practiceName,
      displayName: data.displayName?.trim() || undefined,
    } satisfies RememberedLogin),
  );
  await deviceDeleteItem(LEGACY_EMAIL_KEY);
}

export async function getRememberedLogin(): Promise<RememberedLogin | null> {
  const raw = await deviceGetItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RememberedLogin;
      if (parsed?.email && parsed?.practiceName) return parsed;
    } catch {
      /* fall through to legacy */
    }
  }

  const legacyEmail = await deviceGetItem(LEGACY_EMAIL_KEY);
  if (legacyEmail?.trim()) {
    return { email: legacyEmail.trim(), practiceName: '' };
  }
  return null;
}

export async function clearRememberedLogin(): Promise<void> {
  await deviceDeleteItem(KEY);
  await deviceDeleteItem(LEGACY_EMAIL_KEY);
}
