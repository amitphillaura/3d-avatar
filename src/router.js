/**
 * Minimal client-side router.
 * Routes: 'home' | 'motion-capture' | 'object-detection'
 */

const VALID_ROUTES = ['home', 'motion-capture', 'object-detection', 'vrm-editor', 'mesh'];

let _current = 'home';

function getViewId(route) {
  return `view-${route}`;
}

export function navigate(route) {
  if (!VALID_ROUTES.includes(route)) {
    console.warn(`[router] unknown route: ${route}`);
    return;
  }

  // Hide all views
  VALID_ROUTES.forEach((r) => {
    const el = document.getElementById(getViewId(r));
    if (el) el.hidden = true;
  });

  // Show requested view
  const target = document.getElementById(getViewId(route));
  if (target) target.hidden = false;

  _current = route;
  history.replaceState(null, '', `#${route}`);
}

export function currentRoute() {
  return _current;
}

export function initRouter() {
  // Read hash on load
  const hash = location.hash.replace('#', '');
  const initial = VALID_ROUTES.includes(hash) ? hash : 'home';
  navigate(initial);

  window.addEventListener('popstate', () => {
    const h = location.hash.replace('#', '');
    if (VALID_ROUTES.includes(h)) navigate(h);
  });
}
