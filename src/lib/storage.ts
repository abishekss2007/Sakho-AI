import { z } from 'zod';
import { SPEEDS } from '@/lib/api/contracts';
import { LANGUAGE_CODES } from '@/lib/languages';

/**
 * Only non-sensitive preferences are stored on the device. Chat messages,
 * questionnaire answers and document status are never written here.
 */

export const PREFS_KEY = 'sakho-ai:prefs:v1';

/**
 * Keys the earlier "Thozhi" build may have used for the tutorial flag. The
 * original source was not available, so these are best-effort candidates.
 */
export const LEGACY_TUTORIAL_KEYS = ['thozhi:tutorialSeen', 'thozhi_tutorial_seen', 'thozhi-tutorial-seen'] as const;

const prefsSchema = z.object({
  language: z.enum(LANGUAGE_CODES).nullable(),
  speed: z.enum(SPEEDS),
  autoRead: z.boolean(),
  introSeen: z.boolean(),
});
export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = { language: null, speed: 'normal', autoRead: false, introSeen: false };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Access itself can throw when storage is blocked.
    return undefined;
  }
}

/** Never throws: blocked or corrupt storage yields defaults. */
export function loadPrefs(storage: StorageLike | undefined = defaultStorage()): Prefs {
  if (!storage) return DEFAULT_PREFS;
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = prefsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
    // First run under the new name: carry over the old tutorial preference.
    const legacySeen = LEGACY_TUTORIAL_KEYS.some((key) => {
      const value = storage.getItem(key);
      return value === 'true' || value === '1';
    });
    if (legacySeen) {
      const migrated = { ...DEFAULT_PREFS, introSeen: true };
      savePrefs(migrated, storage);
      LEGACY_TUTORIAL_KEYS.forEach((key) => storage.removeItem(key));
      return migrated;
    }
  } catch {
    // Fall through to defaults.
  }
  return DEFAULT_PREFS;
}

/** Returns false when the preference could not be stored. */
export function savePrefs(prefs: Prefs, storage: StorageLike | undefined = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
