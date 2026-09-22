import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const catalog = JSON.parse(readFileSync(new URL('./astra-responses.json', import.meta.url)));
const digest = value => createHash('sha256').update(value).digest();
const MAX_AUDIO = 2 * 1024 * 1024;

export function createAstraServer(env = process.env, upstream = fetch) {
  const {ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ASTRA_ACCESS_CODE, ALLOWED_ORIGIN} = env;
  if (!ELEVENLABS_API_KEY || !/^[a-zA-Z0-9_-]{1,100}$/.test(ELEVENLABS_VOICE_ID || '') || (ASTRA_ACCESS_CODE || '').length < 32) throw new Error('Configurer la clé, la voix et un code staff aléatoire de 32 caractères minimum.');
  const origin = new URL(ALLOWED_ORIGIN);
  if (origin.origin !== ALLOWED_ORIGIN || origin.protocol !== 'https:') throw new Error('ALLOWED_ORIGIN doit être une origine HTTPS exacte, sans chemin ni slash final.');
  const dailyLimit = Number(env.DAILY_CHARACTER_LIMIT || 20000);
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000000) throw new Error('Quota caractères invalide.');
  const cache = new Map(), pending = new Map();
  let cacheBytes = 0, minute = 0, requests = 0, day = '', characters = 0;
  async function synthesize(lang, file) {
    const key = lang + ':' + file;
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw {status: 429};
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; characters = 0; }
    const text = catalog[lang][file];
    if (characters + text.length > dailyLimit) throw {status: 429};
    characters += text.length; // Réserver AVANT l'appel, même si le fournisseur échoue.
    const job = (async () => {
      const response = await upstream('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(ELEVENLABS_VOICE_ID) + '?output_format=mp3_44100_128', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6500),
        headers: {'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg'},
        body: JSON.stringify({text, model_id: 'eleven_flash_v2_5', language_code: lang,
          voice_settings: {stability: 0.5, similarity_boost: 0.75}})
      });
      if (!response.ok || !(response.headers.get('content-type') || '').startsWith('audio/mpeg')) { await response.body?.cancel(); throw {status: 502}; }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_AUDIO) throw {status: 502};
        chunks.push(chunk);
      }
      if (!size) throw {status: 502};
      const audio = Buffer.concat(chunks);
      while (cacheBytes + size > 16 * 1024 * 1024 && cache.size) {
        const oldest = cache.keys().next().value;
        cacheBytes -= cache.get(oldest).length; cache.delete(oldest);
      }
      cache.set(key, audio); cacheBytes += size;
      return audio;
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const send = (status, message = '') => { res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(message); };
    if (req.url === '/health' && req.method === 'GET') return send(200, 'ok');
    if (req.url !== '/tts') return send(404);
    if (req.headers.origin !== ALLOWED_ORIGIN) return send(403);
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return send(204);
    }
    if (req.method !== 'POST') return send(405);
    // Limite globale : ne dépend pas d'une adresse IP transmise par un client.
    const now = Math.floor(Date.now() / 60000);
    if (now !== minute) { minute = now; requests = 0; }
    if (++requests > 120) { res.setHeader('Retry-After', '60'); return send(429); }
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest('Bearer ' + ASTRA_ACCESS_CODE))) return send(401);
    if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return send(415);
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (Buffer.byteLength(body) > 1024) { send(413); req.resume(); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch (_) { return send(400); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'file,lang') return send(400);
      const {lang, file} = input;
      if (!['fr', 'en', 'de'].includes(lang) || typeof file !== 'string' || !Object.prototype.hasOwnProperty.call(catalog[lang], file)) return send(400);
      const audio = await synthesize(lang, file);
      if (res.destroyed) return;
      res.writeHead(200, {'Content-Type': 'audio/mpeg', 'Content-Length': audio.length}); res.end(audio);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(error.status || 502, 'Synthèse indisponible');
      // Ne jamais renvoyer/loguer une réponse fournisseur ou les secrets.
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAstraServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Proxy Astra prêt'));
}
