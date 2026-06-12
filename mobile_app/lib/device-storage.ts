import { requireOptionalNativeModule } from 'expo-modules-core';
import { NativeModules } from 'react-native';

type SecureStoreType = typeof import('expo-secure-store');
type AsyncStorageType = typeof import('@react-native-async-storage/async-storage').default;

/** Expo SecureStore limit — larger values go to AsyncStorage when available. */
const SECURE_STORE_BYTE_LIMIT = 2048;
const LARGE_KEY_PREFIX = 'device-large:';

const memory = new Map<string, string>();
let useMemory = false;
let secureModule: SecureStoreType | null | undefined;
let asyncStorageModule: AsyncStorageType | null | undefined;

let cachedSecureAvailability: boolean | null = null;
function isExpoSecureStoreAvailable(): boolean {
  if (cachedSecureAvailability !== null) return cachedSecureAvailability;
  try {
    cachedSecureAvailability =
      requireOptionalNativeModule('ExpoSecureStore') != null ||
      (NativeModules as { ExpoSecureStore?: unknown }).ExpoSecureStore != null;
    return cachedSecureAvailability;
  } catch {
    cachedSecureAvailability = false;
    return false;
  }
}

let cachedAsyncAvailability: boolean | null = null;
function isAsyncStorageAvailable(): boolean {
  if (cachedAsyncAvailability !== null) return cachedAsyncAvailability;
  try {
    cachedAsyncAvailability =
      requireOptionalNativeModule('RNCAsyncStorage') != null ||
      (NativeModules as { RNCAsyncStorage?: unknown }).RNCAsyncStorage != null;
    return cachedAsyncAvailability;
  } catch {
    cachedAsyncAvailability = false;
    return false;
  }
}

function getSecureStore(): SecureStoreType | null {
  if (useMemory) return null;
  if (!isExpoSecureStoreAvailable()) {
    secureModule = null;
    return null;
  }
  if (secureModule) return secureModule;
  try {
    secureModule = require('expo-secure-store') as SecureStoreType;
    return secureModule;
  } catch {
    secureModule = null;
    return null;
  }
}

/** Lazy-load AsyncStorage — top-level import crashes if native module is not in the dev build yet. */
function getAsyncStorage(): AsyncStorageType | null {
  if (asyncStorageModule !== undefined) return asyncStorageModule;
  if (!isAsyncStorageAvailable()) {
    asyncStorageModule = null;
    return null;
  }
  try {
    const mod = require('@react-native-async-storage/async-storage').default as AsyncStorageType;
    asyncStorageModule = mod;
    return mod;
  } catch {
    asyncStorageModule = null;
    return null;
  }
}

function largeStorageKey(key: string) {
  return `${LARGE_KEY_PREFIX}${key}`;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

async function removeLargeValue(key: string) {
  memory.delete(largeStorageKey(key));
  const AS = getAsyncStorage();
  if (!AS) return;
  try {
    await AS.removeItem(largeStorageKey(key));
  } catch {
    /* ignore */
  }
}

export async function deviceSetItem(key: string, value: string): Promise<void> {
  memory.set(key, value);

  if (byteLength(value) > SECURE_STORE_BYTE_LIMIT) {
    const SS = getSecureStore();
    if (SS) {
      try {
        await SS.deleteItemAsync(key);
      } catch {
        /* ignore */
      }
    }
    const AS = getAsyncStorage();
    if (AS) {
      try {
        await AS.setItem(largeStorageKey(key), value);
        return;
      } catch {
        /* fall through to memory */
      }
    }
    memory.set(largeStorageKey(key), value);
    return;
  }

  await removeLargeValue(key);

  const SS = getSecureStore();
  if (!SS) return;
  try {
    await SS.setItemAsync(key, value);
  } catch {
    useMemory = true;
  }
}

export async function deviceGetItem(key: string): Promise<string | null> {
  const cachedLarge = memory.get(largeStorageKey(key));
  if (cachedLarge != null) return cachedLarge;

  const AS = getAsyncStorage();
  if (AS) {
    try {
      const large = await AS.getItem(largeStorageKey(key));
      if (large != null) {
        memory.set(key, large);
        return large;
      }
    } catch {
      /* try secure store / memory */
    }
  }

  const SS = getSecureStore();
  if (!SS) return memory.get(key) ?? null;
  try {
    const secure = (await SS.getItemAsync(key)) ?? null;
    if (secure != null) {
      memory.set(key, secure);
      return secure;
    }
    return memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function deviceDeleteItem(key: string): Promise<void> {
  memory.delete(key);
  await removeLargeValue(key);
  const SS = getSecureStore();
  if (!SS) return;
  try {
    await SS.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}
