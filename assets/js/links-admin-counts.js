(() => {
  const config = window.ArbatTrainingSyncConfig;
  const publicKey = config?.publicKey || config?.publishableKey;
  if (!config?.enabled || !config.url || !publicKey) return;

  const page = document.querySelector('.links-page');
  const number = new Intl.NumberFormat('es-BO');
  const localDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/La_Paz'});
  const badges = [];
  let request;
  let verifiedToken;

  function token() {
    const auth = window.Buddy?.auth;
    return auth?.isAuthenticated?.() ? auth.getAccessToken?.() : null;
  }

  function clear() {
    request?.controller.abort();
    request = undefined;
    verifiedToken = undefined;
    for (const {link, badge, description} of badges.splice(0)) {
      link.removeAttribute('aria-describedby');
      badge.remove();
      description.remove();
    }
  }

  async function refresh(force = false) {
    const current = token();
    if (current && (request?.token === current || (!force && verifiedToken === current))) return;
    clear();
    if (!current) return;

    const pending = {token: current, controller: new AbortController()};
    request = pending;
    const to = localDate.format(new Date());
    const start = new Date(to + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - 29);
    const from = start.toISOString().slice(0, 10);

    try {
      const response = await fetch(config.url.replace(/\/$/, '') + '/functions/v1/training-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publicKey,
          Authorization: 'Bearer ' + publicKey,
          'x-buddy-access-token': current
        },
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.any([pending.controller.signal, AbortSignal.timeout(10000)]),
        body: JSON.stringify({schema_version: 1, action: 'usage.summary', from, to})
      });
      if (response.status === 403 && request === pending) verifiedToken = current;
      if (!response.ok) return;

      const report = await response.json();
      if (request !== pending || token() !== current || report.status !== 'accepted' ||
          !['admin', 'superadmin'].includes(report.role) || !report.links) return;

      for (const item of page.querySelectorAll('[data-links-action]')) {
        const total = report.links[item.dataset.linksAction];
        if (!Number.isSafeInteger(total) || total < 0) continue;

        const link = item.matches('a') ? item : item.querySelector('a');
        const badge = document.createElement('span');
        const value = number.format(total);
        badge.className = 'links-page__count';
        badge.textContent = value;
        badge.title = `${value} clics en los últimos 30 días`;
        badge.setAttribute('aria-hidden', 'true');

        const description = document.createElement('span');
        description.id = 'links-click-count-' + item.dataset.linksAction;
        description.hidden = true;
        description.textContent = badge.title;
        link.setAttribute('aria-describedby', description.id);
        badges.push({link, badge, description});
        link.append(badge, description);
      }
      verifiedToken = current;
    } catch {
      // A failed report leaves the links usable.
    } finally {
      if (request === pending) request = undefined;
    }
  }

  for (const event of ['buddy:auth-ready', 'buddy:auth-state-changed', 'buddy:user-loaded']) {
    window.addEventListener(event, () => refresh());
  }
  window.addEventListener('buddy:auth-logout', clear);
  window.addEventListener('pageshow', () => refresh(true));
  window.addEventListener('pagehide', clear);
  refresh();
})();
