/**
 * Teste do transbordo, só por sockets (setup/teardown ficam no SQL ao lado).
 * Roda com a API em localhost:3000 e o cenário já aplicado.
 */
const { io } = require('socket.io-client');

const API = 'http://localhost:3000';
const UNIT_A101 = '08e2be57-3c48-4ccb-8fc8-50364776c263';

let falhas = 0;
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, desc) {
  log(`   ${cond ? '✅' : '❌'} ${desc}`);
  if (!cond) falhas++;
}

async function jwtFor(email) {
  const r1 = await fetch(`${API}/auth/request-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
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
  s.on('call:incoming', (p) => { s.ev.push('incoming'); log(`     📞 ${name} tocando (etapa ${p.stage}/${p.stages})`); });
  s.on('call:cancelled', () => { s.ev.push('cancelled'); log(`     🔇 ${name} parou`); });
  s.on('call:ended', () => { s.ev.push('ended'); log(`     ⏹  ${name} encerrada`); });
  return s;
}

(async () => {
  const ana = resident(await jwtFor('ana@demo.test'), 'ana');
  const bruno = resident(await jwtFor('bruno@demo.test'), 'bruno');
  // O condo demo tem cerca virtual: o entregador precisa do passe de geo.
  const geo = await fetch(`${API}/q/demo?lat=-23.5510&lng=-46.6333`).then((r) => r.json());
  const delivery = io(`${API}/calls`, { transports: ['websocket'], auth: { role: 'delivery', qrToken: 'demo', geoPass: geo.geo_pass } });
  delivery.on('call:answered', () => { delivery.answered = true; });
  delivery.on('call:declined', () => { delivery.declined = true; });
  delivery.on('call:missed', () => { delivery.missed = true; });
  await wait(1500);

  log('1) entregador chama A·101 — deve tocar só na ana');
  const ack = await new Promise((res) => delivery.emit('call:start', { unitId: UNIT_A101, media: 'audio' }, res));
  if (!ack.ok) { log('   ❌ call:start falhou: ' + ack.error); process.exit(1); }
  await wait(1000);
  check(ana.ev.includes('incoming'), 'ana está tocando');
  check(!bruno.ev.includes('incoming'), 'bruno NÃO está tocando (ainda não é a vez)');

  log('\n2) bruno tenta atender fora da vez — deve ser barrado');
  const roubo = await new Promise((res) => bruno.emit('call:answer', { callId: ack.callId }, res));
  check(!roubo.ok, `rejeitado ("${roubo.error}")`);

  log('\n3) ana recusa — deve transbordar pro bruno, sem encerrar a chamada');
  await new Promise((res) => ana.emit('call:decline', { callId: ack.callId }, res));
  await wait(1000);
  check(bruno.ev.includes('incoming'), 'bruno passou a tocar');
  check(ana.ev.includes('cancelled'), 'ana parou de tocar');
  check(!delivery.declined, 'entregador NÃO viu "recusada" (ainda há fila)');

  log('\n4) bruno atende — agora é a vez dele');
  const ans = await new Promise((res) => bruno.emit('call:answer', { callId: ack.callId }, res));
  await wait(1000);
  check(ans.ok, 'bruno conseguiu atender');
  check(!!delivery.answered, 'entregador recebeu "atendida"');

  log('\n5) entregador encerra');
  delivery.emit('call:end', { callId: ack.callId });
  await wait(1000);
  check(bruno.ev.includes('ended'), 'bruno recebeu "encerrada"');

  log(`\ncallId=${ack.callId}`);
  log(falhas === 0 ? '\n🟢 TODOS OS CHECKS PASSARAM' : `\n🔴 ${falhas} CHECK(S) FALHARAM`);
  ana.close(); bruno.close(); delivery.close();
  process.exit(falhas === 0 ? 0 : 1);
})();
