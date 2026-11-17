/**
 * Two stores with a hard line between them:
 *  - Local (this browser only): the original text and the vault of real values.
 *  - Firestore (synced): only the blindfolded document and blindfolded answers.
 */
import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getServices } from './firebase';
import type { VaultState } from './types';

/* ---------- local, never synced ---------- */

const LOCAL_PREFIX = 'blindfold.local.v1.';

export interface LocalRecord {
  text: string;
  vault: VaultState;
}

export function saveLocal(threadId: string, record: LocalRecord): void {
  try {
    localStorage.setItem(LOCAL_PREFIX + threadId, JSON.stringify(record));
  } catch {
    // Storage full or blocked: the session still works, it just won't survive a reload.
  }
}

export function loadLocal(threadId: string): LocalRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + threadId);
    return raw ? (JSON.parse(raw) as LocalRecord) : null;
  } catch {
    return null;
  }
}

export function removeLocal(threadId: string): void {
  try {
    localStorage.removeItem(LOCAL_PREFIX + threadId);
  } catch {
    /* ignore */
  }
}

/** Deletes every original document and vault stored in this browser. */
export function wipeLocal(): number {
  let removed = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(LOCAL_PREFIX)) {
        localStorage.removeItem(key);
        removed++;
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/* ---------- auth ---------- */

export function watchUser(onUser: (user: User | null) => void): () => void {
  const s = getServices();
  if (!s) return () => {};
  const unsubscribe = onAuthStateChanged(s.auth, (user) => {
    onUser(user);
    // Everyone gets a private space without a sign-up form.
    if (!user) signInAnonymously(s.auth).catch(() => {});
  });
  return unsubscribe;
}

/** Upgrades the anonymous session to Google so blindfolded threads follow the user across devices. */
export async function signInWithGoogle(): Promise<void> {
  const s = getServices();
  if (!s) return;
  const provider = new GoogleAuthProvider();
  const current = s.auth.currentUser;
  if (current?.isAnonymous) {
    try {
      await linkWithPopup(current, provider);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/credential-already-in-use' && code !== 'auth/email-already-in-use') throw err;
    }
  }
  await signInWithPopup(s.auth, provider);
}

export async function signOutUser(): Promise<void> {
  const s = getServices();
  if (s) await signOut(s.auth);
}

/* ---------- Firestore: blindfolded data only ---------- */

export interface SavedTurn {
  label: string;
  /** Blindfolded request text. */
  question: string;
  /** Blindfolded answer text, exactly as the model wrote it. */
  answer: string;
  source: 'on_device' | 'in_cloud';
  mode: string;
  at: number;
}

export interface SavedThread {
  id: string;
  title: string;
  maskedDocument: string;
  protectedValues: number;
  turns: SavedTurn[];
  updatedAt: number;
}

const threadsRef = (uid: string) => {
  const s = getServices();
  if (!s) throw new Error('Firebase is not configured');
  return collection(s.db, 'users', uid, 'threads');
};

export async function saveThread(uid: string, thread: SavedThread): Promise<void> {
  await setDoc(doc(threadsRef(uid), thread.id), {
    title: thread.title.slice(0, 120),
    maskedDocument: thread.maskedDocument,
    protectedValues: thread.protectedValues,
    turns: thread.turns.slice(-30),
    updatedAt: thread.updatedAt,
    serverTime: serverTimestamp(),
  });
}

export function watchThreads(uid: string, onThreads: (threads: SavedThread[]) => void): () => void {
  if (!getServices()) return () => {};
  const q = query(threadsRef(uid), orderBy('updatedAt', 'desc'), limit(20));
  return onSnapshot(
    q,
    (snap) =>
      onThreads(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title ?? 'Untitled'),
            maskedDocument: String(data.maskedDocument ?? ''),
            protectedValues: Number(data.protectedValues ?? 0),
            turns: Array.isArray(data.turns) ? (data.turns as SavedTurn[]) : [],
            updatedAt: Number(data.updatedAt ?? 0),
          };
        }),
      ),
    () => onThreads([]),
  );
}

export async function deleteThread(uid: string, threadId: string): Promise<void> {
  await deleteDoc(doc(threadsRef(uid), threadId));
  removeLocal(threadId);
}
