import { ControlView } from './ControlView';
import { DisplayView } from './DisplayView';
import { RemoteControlView } from '../web/RemoteControlView';

export function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const mode = params.get('mode');
  const webRuntime = !window.teleprompter;

  if (view === 'display') return <DisplayView />;
  if (mode === 'display') return <DisplayView remoteMode={webRuntime} />;

  const mobileWeb = webRuntime
    && !mode
    && window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  if (webRuntime && (mode === 'control' || mobileWeb)) return <RemoteControlView />;

  return <ControlView />;
}
