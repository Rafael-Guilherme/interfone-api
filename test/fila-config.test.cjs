/**
 * A fila configurada pelo morador precisa valer na chamada de verdade.
 *
 * Monta e desfaz a própria configuração pela API (não depende de estado
 * deixado por outro teste). Só precisa do cenário de membros:
 * transbordo.setup.sql, que põe ana e bruno na A·101.
 */
const { io } = require('socket.io-client');

const API = 'http://localhost:3000';
const UNIT_A101 = '08e2be57-3c48-4ccb-8fc8-50364776c263';
const CONDO = '42a5c312-6add-40e0-a353-a7e84b378a17';

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

function resident(token, nome) {
  const s = io(`${API}/calls`, { transports: ['websocket'], auth: { role: 'resident', token } });
  s.ev = [];
  s.on('call:incoming', (p) => { s.ev.push('incoming'); log(`     📞 ${nome} tocando (etapa ${p.stage}/${p.stages})`); });
  s.on('call:cancelled', () => s.ev.push('cancelled'));
  return s;
}

/** Lê a fila da A·101 pela API, como a ana (dona da unidade). */
async function lerFila(tokenAna) {
  const r = await fetch(`${API}/condominiums/${CONDO}/resident/call-queue`, {
    headers: { Authorization: `Bearer ${tokenAna}` },
  }).then((x) => x.json());
  return r.find((u) => u.unit_id === UNIT_A101);
}

async function gravarFila(tokenAna, entradas) {
  const r = await fetch(`${API}/condominiums/${CONDO}/resident/call-queue`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAna}` },
    body: JSON.stringify({ unit_id: UNIT_A101, entradas }),
  });
  if (!r.ok) throw new Error('falha ao gravar a fila: ' + (await r.text()));
}

(async () => {
  const tokenAna = await jwtFor('ana@demo.test');

  // --- monta: bruno 1º e na fila; ana fora da fila ---
  const antes = await lerFila(tokenAna);
  if (!antes) { log('❌ A·101 não encontrada — rode transbordo.setup.sql antes'); process.exit(1); }
  const idAna = antes.moradores.find((m) => m.sou_eu).profile_id;
  const idBruno = antes.moradores.find((m) => !m.sou_eu)?.profile_id;
  if (!idBruno) { log('❌ cenário exige 2 moradores na A·101 (transbordo.setup.sql)'); process.exit(1); }
  await gravarFila(tokenAna, [
    { profile_id: idBruno, na_fila: true },
    { profile_id: idAna, na_fila: false },
  ]);

  const ana = resident(tokenAna, 'ana');
  const bruno = resident(await jwtFor('bruno@demo.test'), 'bruno');
  const geo = await fetch(`${API}/q/demo?lat=-23.5510&lng=-46.6333`).then((r) => r.json());
  const delivery = io(`${API}/calls`, {
    transports: ['websocket'], auth: { role: 'delivery', qrToken: 'demo', geoPass: geo.geo_pass },
  });
  await wait(1500);

  log('fila configurada: bruno participa (1º), ana está FORA\n');
  log('entregador chama A·101');
  const ack = await new Promise((res) => delivery.emit('call:start', { unitId: UNIT_A101, media: 'audio' }, res));
  if (!ack.ok) { log('   ❌ call:start falhou: ' + ack.error); process.exit(1); }
  await wait(1200);

  check(bruno.ev.includes('incoming'), 'bruno tocou (está na fila)');
  check(!ana.ev.includes('incoming'), 'ana NÃO tocou (foi tirada da fila)');
  check(ack.residentsOnline !== undefined, `fila reportada com ${ack.residentsOnline} online`);

  delivery.emit('call:end', { callId: ack.callId });
  await wait(600);

  // --- restaura: todos na fila, ordem original ---
  await gravarFila(tokenAna, [
    { profile_id: idAna, na_fila: true },
    { profile_id: idBruno, na_fila: true },
  ]);
  log('\n(fila restaurada: ana e bruno na fila)');

  log(falhas === 0 ? '\n🟢 TODOS OS CHECKS PASSARAM' : `\n🔴 ${falhas} CHECK(S) FALHARAM`);
  ana.close(); bruno.close(); delivery.close();
  process.exit(falhas === 0 ? 0 : 1);
})();
