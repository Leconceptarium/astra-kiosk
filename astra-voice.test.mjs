import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAstraServer} from './astra-server.mjs';

const env = {ELEVENLABS_API_KEY: 'fake-provider-key', ELEVENLABS_VOICE_ID: 'test_voice', ASTRA_ACCESS_CODE: 'test-only-access-code-32-characters', ALLOWED_ORIGIN: 'https://leconceptarium.github.io'};
const catalog = JSON.parse(fs.readFileSync(new URL('./astra-responses.json', import.meta.url)));
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const map = vm.runInNewContext('(' + script.match(/const audioFiles = (\{[\s\S]*?\n  \});/)[1] + ')');
async function fixture(t, upstream, overrides = {}) {
  const server = createAstraServer({...env, ...overrides}, upstream);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  return (input = {lang: 'fr', file: map.fr.bonjour}, headers = {}, method = 'POST') => fetch(base + '/tts', {
    method, headers: {Origin: env.ALLOWED_ORIGIN, Authorization: 'Bearer ' + env.ASTRA_ACCESS_CODE, 'Content-Type': 'application/json', ...headers},
    ...(method === 'POST' ? {body: typeof input === 'string' ? input : JSON.stringify(input)} : {})
  });
}
test('syntaxe du kiosk et des scripts client; couverture FR/EN/DE', () => {
  new vm.Script(script);
  for (const file of ['astra-voice.js', 'astra-voice-config.js']) new vm.Script(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
  for (const lang of ['fr','en','de']) {
    assert.equal(Object.keys(catalog[lang]).length, 22);
    for (const file of Object.keys(catalog[lang])) assert.ok(Object.values(map[lang]).flat().includes(file));
    for (const intent of ['mdp','notif','parchemin','indice_aide','mdp_oublie','rire','berceuse']) assert.ok(!catalog[lang][map[lang][intent]]);
  }
});
test('configuration fermée par défaut', () => {
  assert.throws(() => createAstraServer({}));
  assert.throws(() => createAstraServer({...env, ALLOWED_ORIGIN: '*'}));
  assert.throws(() => createAstraServer({...env, ASTRA_ACCESS_CODE: '1234'}));
});
test('authentification, origine, prévol, schéma et taille avant fournisseur', async t => {
  let calls = 0;
  const request = await fixture(t, async () => { calls++; throw Error('must not call'); });
  assert.equal((await request(undefined, {Authorization: ''})).status, 401);
  assert.equal((await request(undefined, {Origin: 'https://attacker.example'})).status, 403);
  const preflight = await request(undefined, {Authorization: ''}, 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  for (const input of [null, [], {}, {lang:'es',file:map.fr.bonjour}, {lang:'fr',file:'__proto__'}, {lang:'fr',file:map.fr.bonjour,text:'arbitrary text'}, '{bad']) assert.equal((await request(input)).status, 400);
  assert.equal((await request('x'.repeat(1025))).status, 413);
  assert.equal((await request(undefined, {'Content-Type':'text/plain'})).status, 415);
  assert.equal(calls, 0);
});
test('synthèse réelle simulée, langue, cache, secret uniquement en amont', async t => {
  const calls = [];
  const request = await fixture(t, async (url, options) => {
    calls.push({url, options});
    return new Response(new Uint8Array([73,68,51]), {headers:{'Content-Type':'audio/mpeg'}});
  });
  for (const lang of ['fr','en','de']) {
    const input = {lang, file: map[lang].bonjour};
    assert.equal((await request(input)).status, 200);
    const cached = await request(input);
    assert.equal(cached.headers.get('cache-control'), 'no-store');
    assert.equal((await cached.arrayBuffer()).byteLength, 3);
  }
  assert.equal(calls.length, 3);
  calls.forEach(({url,options}, i) => {
    assert.ok(url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/test_voice'));
    assert.equal(options.headers['xi-api-key'], env.ELEVENLABS_API_KEY);
    const body = JSON.parse(options.body);
    assert.equal(body.language_code, ['fr','en','de'][i]);
    assert.equal(body.model_id, 'eleven_flash_v2_5');
    assert.equal(body.text, catalog[body.language_code][map[body.language_code].bonjour]);
  });
});
test('erreur fournisseur masquée et quota réservé avant appel', async t => {
  let calls = 0;
  const request = await fixture(t, async () => { calls++; return new Response('sensitive-provider-message', {status:401}); }, {DAILY_CHARACTER_LIMIT: String(catalog.fr[map.fr.bonjour].length)});
  const failed = await request();
  assert.equal(failed.status, 502);
  assert.equal(await failed.text(), 'Synthèse indisponible');
  assert.equal((await request()).status, 429);
  assert.equal(calls, 1);
});

function player(resolve) {
  const timers = new Map(); let n = 0;
  class Audio {
    constructor() { this.src = ''; this.plays = 0; }
    pause() {} load() {} getAttribute() { return this.src; }
    play() { this.plays++; return Promise.resolve(); }
  }
  const state = {isPlaying: false};
  const events = [], revoked = [];
  const context = {Audio, state, VIDEO: {talk:'talk.mp4'}, window: {astraVoice:true}, astraVoice:{resolve},
    URL:{revokeObjectURL: value => revoked.push(value)},
    videoManager:{playReaction:v=>events.push(v),endReaction:()=>{state.isPlaying=false;events.push('end');}},
    parcheminManager:{show:()=>events.push('scroll'),finishIfReady:()=>events.push('scroll-end')},
    debugLogger:{log(){}},utils:{showError(){}},
    clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++n,fn);return n;}};
  const source = script.slice(script.indexOf('  const audioManager = {'), script.indexOf('// FIN PARTIE 5'));
  const audio = vm.runInNewContext(source + '\naudioManager;', context);
  return {audio, state, events, revoked, context};
}
test('attente synthèse bloque les doubles réponses et conserve le lecteur iPad', async () => {
  let release;
  const p = player(() => new Promise(r => {release=r;}));
  const reader = p.audio.currentAudio;
  const playing = p.audio.play('salutation_bonjour.mp3');
  assert.equal(p.state.isPlaying, true);
  assert.deepEqual(p.events, []);
  await p.audio.play('other.mp3');
  release('blob:voice'); await playing;
  assert.equal(p.audio.currentAudio, reader);
  assert.equal(reader.src, 'blob:voice');
  reader.onplaying();
  assert.equal(p.state.lastResponse.file, 'salutation_bonjour.mp3');
  reader.onended();
  assert.equal(p.state.isPlaying, false);
  assert.deepEqual(p.revoked, ['blob:voice']);
});
test('panne proxy utilise MP3; panne audio généré retente MP3 une seule fois', async () => {
  const offline = player(async () => null);
  await offline.audio.play('original.mp3');
  assert.equal(offline.audio.currentAudio.src, 'original.mp3');
  const p = player(async () => 'blob:voice');
  await p.audio.play('original.mp3');
  p.audio.currentAudio.onerror();
  assert.equal(p.audio.currentAudio.src, 'original.mp3');
  assert.equal(p.audio.currentAudio.plays, 2);
  p.audio.currentAudio.onerror();
  assert.equal(p.state.isPlaying, false);
});
test('parchemin garde son déclenchement et sa fin audio', async () => {
  const p = player(async () => null);
  await p.audio.play('parchemin_liberation.mp3', null);
  assert.deepEqual(p.events, ['scroll']);
  p.audio.currentAudio.onended();
  assert.equal(p.context.parcheminManager.audioDone, true);
  assert.deepEqual(p.events, ['scroll','scroll-end']);
});

function client(endpoint, fetcher, code = env.ASTRA_ACCESS_CODE) {
  const elements = {astraVoiceCode:{value:code},astraVoiceStatus:{textContent:''}};
  const context = {window:{ASTRA_VOICE_CONFIG:{endpoint}},document:{getElementById:id=>elements[id]},
    fetch:fetcher, URL, AbortController, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync(new URL('./astra-voice.js', import.meta.url),'utf8'),context);
  return {voice:context.window.astraVoice,elements};
}
test('client sans configuration reste MP3 et efface le code du champ', async () => {
  for (const endpoint of ['', 'not a url', 'http://example.com', 'https://user:pass@example.com', 'https://example.com?key=bad']) {
    let syntheses = 0;
    const c = client(endpoint, async url => {if(url !== './astra-responses.json') syntheses++; return new Response(JSON.stringify(catalog));});
    c.voice.configure();
    assert.equal(c.elements.astraVoiceCode.value, '');
    assert.equal(await c.voice.resolve(map.fr.bonjour), null);
    assert.equal(syntheses, 0);
  }
});
test('client transmet intention/langue uniquement et récupère une URL audio', async () => {
  const calls = [];
  const c = client('https://proxy.example', async (url, options) => {
    if (url === './astra-responses.json') return new Response(JSON.stringify(catalog));
    calls.push({url,options});
    return new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}});
  });
  c.voice.configure();
  for (const lang of ['fr','en','de']) {
    const url = await c.voice.resolve(map[lang].bonjour);
    assert.ok(url.startsWith('blob:')); URL.revokeObjectURL(url);
    assert.equal(c.voice.isDynamic(map[lang].bonjour), true);
  }
  assert.equal(await c.voice.resolve(map.fr.parchemin), null);
  assert.equal(calls.length,3);
  calls.forEach(({url,options}, i) => {
    assert.equal(url,'https://proxy.example/tts');
    assert.equal(options.headers.Authorization,'Bearer '+env.ASTRA_ACCESS_CODE);
    assert.deepEqual(JSON.parse(options.body), {file:map[['fr','en','de'][i]].bonjour,lang:['fr','en','de'][i]});
  });
});
test('client erreur réseau ou mauvais code revient en MP3', async () => {
  for (const fail of [async()=>{throw Error('offline');},async()=>new Response('',{status:401})]) {
    const c = client('https://proxy.example',async(url,options)=>url==='./astra-responses.json'?new Response(JSON.stringify(catalog)):fail());
    c.voice.configure();
    assert.equal(await c.voice.resolve(map.fr.bonjour),null);
    assert.match(c.elements.astraVoiceStatus.textContent,/secours MP3/);
  }
});
