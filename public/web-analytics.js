// Both identifiers are public and scoped to the production Lumassets hostname.
if (location.hostname === 'lumassets.bibliotecadezines.workers.dev') {
  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: '8786380942764fd3824fd82c0288b5b9', spa: false });
  document.body.append(beacon);

  const measurementId = 'G-07J754P9YQ';
  const choiceKey = 'lumassets:analytics';
  const preference = document.querySelector('#analytics-settings');
  const settings = preference.querySelector('button');
  const prompt = document.querySelector('#analytics-prompt');
  const downloadKinds = new Map([
    ['library-svg', 'library-drawing.svg'],
    ['library-png', 'library-drawing.png'],
    ['library-zip', 'library-collection.zip'],
    ['compose-png', 'composition.png'],
    ['compose-svg', 'composition.svg'],
    ['compose-json', 'composition.json'],
  ]);
  const actions = new Set(['nav_compose', 'nav_wall', 'compose_with_drawing', 'wall_remix', 'compose_share']);

  let choice;
  try { choice = localStorage.getItem(choiceKey); } catch { /* The choice can still apply on this page. */ }
  let gtag;
  let openedFromSettings = false;

  function setPrompt(open) {
    prompt.hidden = !open;
    settings.setAttribute('aria-expanded', String(open));
  }

  function enableGoogleAnalytics() {
    window[`ga-disable-${measurementId}`] = false;
    if (gtag) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }

    window.dataLayer ??= [];
    gtag = function () { window.dataLayer.push(arguments); };
    gtag('consent', 'default', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
    });
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    const referrer = document.referrer ? new URL(document.referrer) : null;
    gtag('config', measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: location.origin + location.pathname,
      page_referrer: referrer ? referrer.origin + referrer.pathname : '',
    });
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(tag);
  }

  preference.hidden = false;
  settings.addEventListener('click', () => {
    setPrompt(prompt.hidden);
    openedFromSettings = !prompt.hidden;
    if (openedFromSettings) prompt.querySelector('button').focus();
  });
  prompt.addEventListener('click', (event) => {
    const button = event.target.closest('[data-analytics-choice]');
    if (!button) return;
    choice = button.dataset.analyticsChoice;
    try { localStorage.setItem(choiceKey, choice); } catch { /* Storage is optional. */ }
    setPrompt(false);
    if (openedFromSettings) settings.focus({ preventScroll: true });
    if (choice === 'granted') enableGoogleAnalytics();
    else if (gtag) {
      window[`ga-disable-${measurementId}`] = true;
      gtag('consent', 'update', { analytics_storage: 'denied' });
    }
  });

  window.addEventListener('lumassets:download', ({ detail }) => {
    const name = downloadKinds.get(detail);
    if (choice === 'granted' && name) {
      gtag('event', 'file_download', {
        file_name: name, file_extension: name.split('.').at(-1), download_type: detail,
      });
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element && event.target.closest('[data-analytics-action]');
    const action = target?.dataset.analyticsAction;
    if (choice !== 'granted' || !actions.has(action)) return;
    const name = `${action}_click`;
    // Give queued events a chance to send before a same-tab navigation unloads the page.
    if (target instanceof HTMLAnchorElement && target.origin === location.origin && !target.target
        && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
        && !event.defaultPrevented) {
      event.preventDefault();
      let leaving = false;
      function follow() {
        if (leaving) return;
        leaving = true;
        clearTimeout(fallback);
        location.assign(target.href);
      }
      const fallback = setTimeout(follow, 350);
      gtag('event', name, { event_callback: follow, event_timeout: 350 });
    } else {
      gtag('event', name);
    }
  });

  if (choice === 'granted') enableGoogleAnalytics();
  else if (choice !== 'denied') setPrompt(true);
}
