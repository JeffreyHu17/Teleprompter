import { ControlView } from './ControlView';
import { DisplayView } from './DisplayView';

export function App() {
  const view = new URLSearchParams(window.location.search).get('view');
  return view === 'display' ? <DisplayView /> : <ControlView />;
}
