// This public site token is scoped to the production Lumassets hostname.
if (location.hostname === 'lumassets.bibliotecadezines.workers.dev') {
  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: '8786380942764fd3824fd82c0288b5b9', spa: false });
  document.body.append(beacon);
}
