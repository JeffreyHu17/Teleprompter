import { app } from 'electron';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { preferencesFromState, stateFromPreferences } from '../../src/core/persistence.js';
import type { SessionState } from '../../src/types/session.js';

let persistTimer: NodeJS.Timeout | null = null;

export function preferencesPath(): string {
  return join(app.getPath('userData'), 'teleprompter-preferences.json');
}

export function schedulePersistState(getState: () => SessionState): void {
  if (process.env.TELEPROMPTER_DISABLE_PERSISTENCE === '1') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const path = preferencesPath();
    const currentState = getState();
    void mkdir(dirname(path), { recursive: true })
      .then(() => writeFile(path, JSON.stringify(preferencesFromState(currentState), null, 2), 'utf8'))
      .catch((error) => console.error('Unable to persist teleprompter preferences', error));
  }, 180);
}

export async function restorePersistedState(): Promise<SessionState | null> {
  if (process.env.TELEPROMPTER_DISABLE_PERSISTENCE === '1') return null;
  try {
    const raw = await readFile(preferencesPath(), 'utf8');
    return stateFromPreferences(JSON.parse(raw));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'ENOENT') console.error('Unable to restore teleprompter preferences', error);
    return null;
  }
}
