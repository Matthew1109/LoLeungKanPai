/**
 * iOS standalone (Home Screen) cold-launch workaround.
 * WebKit can lay out the first frame against a stale, shorter viewport (before the status bar / safe areas are
 * resolved), so `position: fixed; bottom: 0` sits too high until something (a swipe, a route change) forces a
 * relayout. We force that relayout ourselves once the launch has settled. Nothing is measured or offset, and
 * outside standalone mode this does nothing.
 */
export function settleViewportOnLaunch(): void {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (!standalone) return;

  const root = document.documentElement;
  const relayout = () => {
    root.style.display = 'none'; // forces a synchronous layout with the real viewport
    void root.offsetHeight;
    root.style.display = '';
  };
  const later = () => requestAnimationFrame(() => requestAnimationFrame(relayout));

  later();
  window.addEventListener('load', later, { once: true });
  window.addEventListener('pageshow', later);
  window.setTimeout(later, 300); // late status-bar / safe-area resolution on a cold launch
  window.setTimeout(later, 1000);
}
