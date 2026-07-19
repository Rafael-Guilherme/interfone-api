/**
 * Geofencing no signaling: um cliente que pula a página web (e portanto não tem
 * o passe) não pode chamar num interfone com cerca virtual.
 * Requer o condo demo com latitude/longitude/geo_radius_m configurados.
 */
const { io } = require('socket.io-client');

const API = 'http://localhost:3000';
const UNIT_A101 = '08e2be57-3c48-4ccb-8fc8-50364776c263';

let falhas = 0;
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, desc) { log(`   ${cond ? '✅' : '❌'} ${desc}`); if (!cond) falhas++; }

/** Conecta como entregador e devolve {conectado, erro}. */
function conectar(auth) {
  return new Promise((resolve) => {
    const s = io(`${API}/calls`, { transports: ['websocket'], auth, reconnection: false });
    const fim = (r) => { s.close(); resolve(r); };
    s.on('connect', async () => {
      // Conectar não basta: o handshake é assíncrono e derruba depois.
      await wait(1200);
      if (s.connected) {
        const ack = await new Promise((res) => s.emit('call:start', { unitId: UNIT_A101, media: 'audio' }, res));
        fim({ conectado: true, ack });
      } else {
        fim({ conectado: false, erro: 'desconectado após handshake' });
      }
    });
    s.on('connect_error', (e) => fim({ conectado: false, erro: e.message }));
    setTimeout(() => fim({ conectado: false, erro: 'timeout' }), 8000);
  });
}

(async () => {
  log('1) sem passe de geolocalização (cliente pulando a web)');
  const semPasse = await conectar({ role: 'delivery', qrToken: 'demo' });
  check(!semPasse.ack?.ok, `chamada recusada (${semPasse.erro ?? 'ack: ' + JSON.stringify(semPasse.ack)})`);

  log('\n2) com passe obtido de posição DENTRO do raio');
  const dentro = await fetch(`${API}/q/demo?lat=-23.5510&lng=-46.6333`).then((r) => r.json());
  const comPasse = await conectar({ role: 'delivery', qrToken: 'demo', geoPass: dentro.geo_pass });
  check(!!comPasse.ack?.ok, 'chamada aceita');
  if (comPasse.ack?.callId) {
    const s = io(`${API}/calls`, { transports: ['websocket'], auth: { role: 'delivery', qrToken: 'demo', geoPass: dentro.geo_pass } });
    await wait(600);
    s.emit('call:end', { callId: comPasse.ack.callId });
    await wait(400);
    s.close();
  }

  log('\n3) passe adulterado');
  const adulterado = await conectar({ role: 'delivery', qrToken: 'demo', geoPass: (dentro.geo_pass ?? '') + 'xx' });
  check(!adulterado.ack?.ok, `recusado (${adulterado.erro ?? 'ack: ' + JSON.stringify(adulterado.ack)})`);

  log(falhas === 0 ? '\n🟢 TODOS OS CHECKS PASSARAM' : `\n🔴 ${falhas} CHECK(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
})();
