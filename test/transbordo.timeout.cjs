/**
 * Transbordo por timeout: ninguém atende, a fila avança sozinha e a chamada
 * termina como `missed`. Rodar com a API usando RING_STEP_TIMEOUT_MS baixo.
 */
const { io } = require('socket.io-client');

const API = 'http://localhost:3000';
const UNIT_A101 = '08e2be57-3c48-4ccb-8fc8-50364776c263';
const STEP_MS = Number(process.env.RING_STEP_TIMEOUT_MS ?? 3000);

let falhas = 0;
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, desc) { log(`   ${cond ? '✅' : '❌'} ${desc}`); if (!cond) falhas++; }

async function jwtFor(email) {
  const r1 = await fetch(`${API}/auth/request-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const r2 = await fetch(`${API}/auth/verify-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: r1.devCode }),
  }).then((r) => r.json());
  return r2.access;
}

function resident(token, name) {
  const s = io(`${API}/calls`, { transports: ['websocket'], auth: { role: 'resident', token } });
  s.ev = [];
  s.on('call:incoming', (p) => { s.ev.push('incoming'); log(`     📞 ${name} tocando (etapa ${p.stage}/${p.stages}) @${Date.now() - s.t0}ms`); });
  s.on('call:cancelled', () => { s.ev.push('cancelled'); log(`     🔇 ${name} parou @${Date.now() - s.t0}ms`); });
  return s;
}

(async () => {
  const ana = resident(await jwtFor('ana@demo.test'), 'ana');
  const bruno = resident(await jwtFor('bruno@demo.test'), 'bruno');
  // O condo demo tem cerca virtual: o entregador precisa do passe de geo.
  const geo = await fetch(`${API}/q/demo?lat=-23.5510&lng=-46.6333`).then((r) => r.json());
  const delivery = io(`${API}/calls`, { transports: ['websocket'], auth: { role: 'delivery', qrToken: 'demo', geoPass: geo.geo_pass } });
  delivery.on('call:missed', () => { delivery.missed = true; log('     ⏱  entregador: NÃO ATENDIDA'); });
  delivery.on('call:declined', () => { delivery.declined = true; });
  await wait(1500);

  log(`etapa = ${STEP_MS}ms; fila = 2 moradores; ninguém vai atender\n`);
  ana.t0 = bruno.t0 = Date.now();
  const ack = await new Promise((res) => delivery.emit('call:start', { unitId: UNIT_A101, media: 'audio' }, res));
  if (!ack.ok) { log('❌ call:start falhou: ' + ack.error); process.exit(1); }

  log('1) etapa 1 — só a ana toca');
  await wait(STEP_MS * 0.5);
  check(ana.ev.includes('incoming') && !bruno.ev.includes('incoming'), 'ana tocando, bruno em espera');

  log('\n2) sem resposta — deve transbordar sozinho pro bruno');
  await wait(STEP_MS);
  check(bruno.ev.includes('incoming'), 'bruno passou a tocar por timeout');
  check(ana.ev.includes('cancelled'), 'ana parou de tocar');
  check(!delivery.missed, 'chamada ainda viva (fila não esgotou)');

  log('\n3) fila esgota — deve virar "não atendida"');
  await wait(STEP_MS * 1.5);
  check(!!delivery.missed, 'entregador recebeu "não atendida"');
  check(!delivery.declined, 'não veio "recusada" (ninguém recusou, só não atendeu)');
  check(bruno.ev.includes('cancelled'), 'bruno parou de tocar');

  log(`\ncallId=${ack.callId}`);
  log(falhas === 0 ? '\n🟢 TODOS OS CHECKS PASSARAM' : `\n🔴 ${falhas} CHECK(S) FALHARAM`);
  ana.close(); bruno.close(); delivery.close();
  process.exit(falhas === 0 ? 0 : 1);
})();
