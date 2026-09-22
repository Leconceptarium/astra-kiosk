/* Le lecteur Audio déverrouillé par le geste iOS reste géré par index.html. */
window.astraVoice = (() => {
  let accessCode = '';
  let catalog = null;
  let catalogPromise = null;
  const status = text => {
    const el = document.getElementById('astraVoiceStatus');
    if (el) el.textContent = text;
  };
  const endpoint = () => {
    const value = (window.ASTRA_VOICE_CONFIG || {}).endpoint || '';
    if (!value) return '';
    let url;
    try { url = new URL(value); } catch (_) { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/$/, '');
  };
  async function loadCatalog() {
    if (!catalogPromise) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 2000);
      catalogPromise = fetch('./astra-responses.json', {cache: 'no-cache', signal: abort.signal})
      .then(r => { if (!r.ok) throw new Error('catalogue'); return r.json(); })
      .then(data => { catalog = data; return data; })
      .catch(() => { catalogPromise = null; return null; })
      .finally(() => clearTimeout(timer));
    }
    return catalogPromise;
  }
  function find(file) {
    if (!catalog) return null;
    for (const lang of ['fr', 'en', 'de']) {
      if (Object.prototype.hasOwnProperty.call(catalog[lang], file)) return {file, lang};
    }
    return null;
  }
  return {
    configure() {
      accessCode = document.getElementById('astraVoiceCode').value.trim();
      document.getElementById('astraVoiceCode').value = '';
      status(endpoint() && accessCode ? 'Voix dynamique activée — MP3 de secours disponibles.' : 'Mode MP3 — proxy ou code staff non renseigné.');
      loadCatalog();
    },
    isDynamic(file) { return Boolean(accessCode && endpoint() && find(file)); },
    async resolve(file) {
      if (!accessCode || !endpoint()) return null;
      await loadCatalog();
      const entry = find(file);
      if (!entry) return null;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8000);
      try {
        const response = await fetch(endpoint() + '/tts', {
          method: 'POST', credentials: 'omit', redirect: 'error',
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + accessCode},
          body: JSON.stringify(entry), signal: abort.signal
        });
        if (!response.ok || !(response.headers.get('content-type') || '').startsWith('audio/mpeg')) throw new Error('proxy');
        const blob = await response.blob();
        if (!blob.size || blob.size > 2 * 1024 * 1024) throw new Error('audio');
        status('Voix ElevenLabs disponible.');
        return URL.createObjectURL(blob);
      } catch (_) {
        status('Voix dynamique indisponible : secours MP3 actif. Vérifier le proxy et le code staff.');
        return null;
      } finally { clearTimeout(timer); }
    }
  };
})();
