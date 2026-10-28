import { lazy, Suspense, useEffect, useState } from 'react';
import { DisplayView } from './DisplayView';

const ControlView = lazy(() => import('./ControlView').then((module) => ({ default: module.ControlView })));
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

const BrowserStudio = lazy(() => import('../web/BrowserStudio').then((module) => ({ default: module.BrowserStudio })));

export function App() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px), (pointer: coarse)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px), (pointer: coarse)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const update = () => setSearch(window.location.search);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const mode = params.get('mode');
  const webRuntime = !window.teleprompter;

  if (view === 'display') return <DisplayView />;
  if (webRuntime && mode === 'display') return <WebRemoteDisplay />;
  if (webRuntime && mode === 'control') {
    return <Suspense fallback={null}><RemoteControlView /></Suspense>;
  }

  if (webRuntime && compact) return <Suspense fallback={null}><BrowserStudio /></Suspense>;
  return <Suspense fallback={null}><ControlView /></Suspense>;
}
