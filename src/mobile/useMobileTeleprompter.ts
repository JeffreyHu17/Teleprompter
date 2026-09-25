import { useCallback, useEffect, useState } from 'react';
import { dispatchBrowserCommand, getBrowserState, subscribeBrowserState } from '../desktop/browserSession';
import type { SessionCommand, SessionState } from '../types/session';

export function useMobileTeleprompter() {
  const [state, setState] = useState<SessionState>(getBrowserState());

  useEffect(() => subscribeBrowserState(setState), []);

  const command = useCallback((next: SessionCommand) => {
    dispatchBrowserCommand(next);
  }, []);

  return { state, command };
}
