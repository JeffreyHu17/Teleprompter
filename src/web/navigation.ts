export function navigateBrowserMode(mode?: 'control' | 'display'): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('mode');
  if (mode) url.searchParams.set('mode', mode);
  url.hash = '';
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
