(() => {
  const config = window.ArbatTrainingSyncConfig;
  const publicKey = config?.publicKey || config?.publishableKey;
  if (!config?.enabled || !config.url || !publicKey || !window.crypto?.randomUUID) return;

  function record(kind) {
    fetch(config.url.replace(/\/$/, '') + '/functions/v1/training-sync', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', apikey: publicKey, Authorization: 'Bearer ' + publicKey},
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      body: JSON.stringify({schema_version: 1, action: 'links.record', event: {id: crypto.randomUUID(), kind}})
    }).catch(() => {});
  }

  function recordClick(event) {
    const action = event.target.closest?.('a[href]')?.closest('[data-links-action]')?.dataset.linksAction;
    if (action) record(action);
  }

  window.addEventListener('pageshow', () => record('open'));
  const page = document.querySelector('.links-page');
  page.addEventListener('click', recordClick);
  page.addEventListener('auxclick', event => {
    if (event.button === 1) recordClick(event);
  });
})();
