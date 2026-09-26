import { lazy, Suspense } from 'react';
import { ControlView } from './ControlView';
import { DisplayView } from './DisplayView';

const RemoteControlView = lazy(() => import('../web/RemoteControlView').then((module) => ({ default: module.RemoteControlView })));
const RemoteDisplayPairing = lazy(() => import('../web/RemoteDisplayPairing').then((module) => ({ default: module.RemoteDisplayPairing })));

function WebRemoteDisplay() {
  return (
    <>
      <DisplayView />
      <Suspense fallback={null}><RemoteDisplayPairing /></Suspense>
    </>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const mode = params.get('mode');
  const webRuntime = !window.teleprompter;

  if (view === 'display') return <DisplayView />;
  if (mode === 'display') return webRuntime ? <WebRemoteDisplay /> : <DisplayView />;

  const mobileWeb = webRuntime
    && !mode
    && window.matchMedia('(max-width: 760px)').matches;
  if (webRuntime && (mode === 'control' || mobileWeb)) {
    return <Suspense fallback={null}><RemoteControlView /></Suspense>;
  }

  return <ControlView />;
}
