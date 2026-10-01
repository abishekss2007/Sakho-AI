'use client';

import { createContext, useContext } from 'react';
import type { Api } from '@/lib/client/api';
import type { SosMode } from '@/lib/emergency';
import type { I18n } from '@/lib/i18n';
import type { Prefs } from '@/lib/storage';

export interface AppServices {
  i18n: I18n;
  prefs: Prefs;
  api: Api;
  online: boolean;
  sosMode: SosMode;
  providers: 'live' | 'mock';
  /** Open emergency help. Stops speech and cancels non-essential work first. */
  openSos(): void;
  /**
   * Register work that must stop when emergency help opens or the screen
   * changes. Returns the function that removes the registration.
   */
  onInterrupt(cancel: () => void): () => void;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext');
  return value;
}
