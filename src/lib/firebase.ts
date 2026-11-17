/**
 * Firebase wiring: App, App Check, AI Logic, Auth, Firestore and Remote Config.
 * The app still opens without a Firebase config (pattern shield only) so the
 * privacy boundary can be inspected before any project is connected.
 */
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import type { AI } from 'firebase/ai';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import type { RemoteConfig } from 'firebase/remote-config';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/** Runtime-tunable policy. Defaults ship in the bundle; Remote Config overrides them. */
export interface AppConfig {
  /** Cloud model for heavy tasks (PREFER_IN_CLOUD / ONLY_IN_CLOUD). */
  cloud_model: string;
  /** Cloud model the SDK falls back to for light tasks (PREFER_ON_DEVICE). */
  fallback_cloud_model: string;
  /** Largest prompt, in estimated tokens, that is routed to the on-device model. */
  on_device_token_budget: number;
  /** Chunk size for on-device entity detection. */
  detect_chunk_chars: number;
  /** Whether users may opt in to cloud-assisted name detection on devices without a local model. */
  allow_cloud_detection: boolean;
  max_document_chars: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  cloud_model: 'gemini-3.8-flash',
  fallback_cloud_model: 'gemini-3.5-flash-lite',
  on_device_token_budget: 4000,
  detect_chunk_chars: 1600,
  allow_cloud_detection: true,
  max_document_chars: 60000,
};

export interface Services {
  app: FirebaseApp;
  ai: AI;
  auth: Auth;
  db: Firestore;
  remoteConfig: RemoteConfig;
  /** False when no attestation provider could be set up; AI Logic calls will be rejected. */
  appCheckReady: boolean;
}

let services: Services | null | undefined;

function setUpAppCheck(app: FirebaseApp): boolean {
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined;
  if (env.DEV) {
    // Local development: use the debug provider. The token comes from a
    // gitignored .env.local, or is generated and printed to the console.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      (env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) || true;
  } else if (!siteKey) {
    return false;
  }
  initializeAppCheck(app, {
    provider: siteKey
      ? new ReCaptchaEnterpriseProvider(siteKey)
      : new CustomProvider({ getToken: () => Promise.reject(new Error('No App Check provider configured')) }),
    isTokenAutoRefreshEnabled: true,
  });
  return true;
}

export function getServices(): Services | null {
  if (services !== undefined) return services;
  if (!isFirebaseConfigured) return (services = null);

  const app = initializeApp(firebaseConfig);
  const appCheckReady = setUpAppCheck(app);
  // Limited-use tokens give Gemini requests replay protection.
  const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const remoteConfig = getRemoteConfig(app);
  remoteConfig.settings.minimumFetchIntervalMillis = env.DEV ? 60_000 : 3_600_000;
  remoteConfig.defaultConfig = { ...DEFAULT_CONFIG };

  return (services = { app, ai, auth, db, remoteConfig, appCheckReady });
}

/** Fetches Remote Config (best effort) and returns the effective policy. */
export async function loadConfig(): Promise<AppConfig> {
  const s = getServices();
  if (!s) return DEFAULT_CONFIG;
  try {
    await fetchAndActivate(s.remoteConfig);
  } catch {
    // Offline or blocked: last activated values or in-app defaults apply.
  }
  const rc = s.remoteConfig;
  const num = (key: keyof AppConfig) => {
    const n = getValue(rc, key).asNumber();
    return Number.isFinite(n) && n > 0 ? n : (DEFAULT_CONFIG[key] as number);
  };
  const str = (key: keyof AppConfig) => getValue(rc, key).asString() || (DEFAULT_CONFIG[key] as string);
  return {
    cloud_model: str('cloud_model'),
    fallback_cloud_model: str('fallback_cloud_model'),
    on_device_token_budget: num('on_device_token_budget'),
    detect_chunk_chars: num('detect_chunk_chars'),
    allow_cloud_detection: getValue(rc, 'allow_cloud_detection').asBoolean(),
    max_document_chars: num('max_document_chars'),
  };
}
