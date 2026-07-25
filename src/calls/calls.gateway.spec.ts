import { CallsGateway } from './calls.gateway';

/**
 * Foco: o transbordo e as transições terminais da chamada.
 *
 * É a regra mais fácil de quebrar sem perceber — ela só se manifesta com o
 * telefone tocando, na casa de alguém. Os testes cobrem quem toca, em que
 * ordem, quem pode atender e como a chamada termina.
 *
 * Socket, LiveKit e push entram mockados; o relógio é falso, para o timeout de
 * 20s da etapa rodar em milissegundos.
 */
describe('CallsGateway — transbordo', () => {
  /** Sala → eventos emitidos, para checar QUEM recebeu o quê. */
  function fakeServer() {
    const emitidos: { sala: string; evento: string; payload: any }[] = [];
    const salasComGente = new Set<string>();
    return {
      emitidos,
      salasComGente,
      to: (sala: string) => ({
        emit: (evento: string, payload: any) => emitidos.push({ sala, evento, payload }),
      }),
      adapter: { rooms: { get: (sala: string) => (salasComGente.has(sala) ? { size: 1 } : undefined) } },
      eventosEm: (sala: string) => emitidos.filter((e) => e.sala === sala).map((e) => e.evento),
    };
  }

  function montar(opcoes: { fila?: string[]; call?: any } = {}) {
    const fila = opcoes.fila ?? ['ana', 'bruno'];
    const chamada = { id: 'c1', status: 'ringing', media: 'audio', ...opcoes.call };

    const prisma = {
      unit: { findFirst: jest.fn().mockResolvedValue({ id: 'unit-101' }) },
      unitMembership: {
        findMany: jest.fn().mockResolvedValue(fila.map((user_id) => ({ profile: { user_id } }))),
      },
      call: {
        create: jest.fn().mockResolvedValue(chamada),
        findUnique: jest.fn().mockResolvedValue(chamada),
        update: jest.fn().mockImplementation(({ data }: any) => {
          Object.assign(chamada, data); // o estado persiste entre chamadas, como no banco
          return Promise.resolve(chamada);
        }),
      },
    } as any;

    const livekit = { issueGrant: jest.fn().mockResolvedValue({ token: 't', url: 'wss://lk' }) } as any;
    const push = {
      notificarChamada: jest.fn().mockResolvedValue(undefined),
      cancelarChamada: jest.fn().mockResolvedValue(undefined),
    } as any;

    const gw = new CallsGateway(prisma, livekit, {} as any, {} as any, push);
    const server = fakeServer();
    (gw as any).server = server;

    return { gw, prisma, livekit, push, server, chamada };
  }

  /** Socket do entregador que abre a chamada. */
  const entregador = { id: 'sock-entregador', data: { role: 'delivery', condoId: 'condo1', ready: null } } as any;
  /** Socket de um morador. `to()` existe porque o answer avisa os outros devices. */
  const morador = (userId: string) =>
    ({ id: `sock-${userId}`, data: { role: 'resident', userId, ready: null }, to: () => ({ emit: jest.fn() }) }) as any;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('recusa a chamada quando a unidade não tem ninguém na fila', async () => {
    const { gw, push } = montar({ fila: [] });
    const ack = await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/Nenhum morador/);
    expect(push.notificarChamada).not.toHaveBeenCalled();
  });

  it('toca em UM morador por vez, na ordem da fila', async () => {
    const { gw, server, push } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    // Só a Ana: o Bruno é a etapa 2 e não pode saber da chamada ainda.
    expect(server.eventosEm('user:ana')).toContain('call:incoming');
    expect(server.eventosEm('user:bruno')).toEqual([]);
    expect(push.notificarChamada).toHaveBeenCalledTimes(1);
    expect(push.notificarChamada.mock.calls[0][0]).toBe('ana');
  });

  it('avisa pelos dois canais — socket e push — com a mesma sala de mídia', async () => {
    const { gw, server, push } = montar({ fila: ['ana'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'video' });

    const socket = server.emitidos.find((e) => e.evento === 'call:incoming')!.payload;
    const [, viaPush] = push.notificarChamada.mock.calls[0];
    expect(viaPush.room).toBe(socket.room);
    expect(viaPush.callId).toBe(socket.callId);
    expect(viaPush.media).toBe('video');
  });

  it('sem resposta na etapa, passa para o próximo da fila', async () => {
    const { gw, server, push } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    await jest.advanceTimersByTimeAsync(21_000);

    // A Ana para de tocar (inclusive nos aparelhos com o app fechado) e o Bruno começa.
    expect(server.eventosEm('user:ana')).toContain('call:cancelled');
    expect(push.cancelarChamada).toHaveBeenCalledWith(['ana'], 'c1');
    expect(server.eventosEm('user:bruno')).toContain('call:incoming');
  });

  it('fila esgotada sem ninguém atender → missed para o entregador', async () => {
    const { gw, server, chamada } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    await jest.advanceTimersByTimeAsync(21_000); // ana → bruno
    await jest.advanceTimersByTimeAsync(21_000); // bruno → fila acabou

    expect(chamada.status).toBe('missed');
    expect(server.eventosEm('sock-entregador')).toContain('call:missed');
  });

  it('só o morador da vez consegue atender', async () => {
    const { gw } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    // Sem esta guarda, qualquer morador da unidade sequestraria a chamada da vez.
    const ack = await gw.onAnswer(morador('bruno'), { callId: 'c1' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/não é a sua vez/);
  });

  it('atender marca answered, devolve o grant e cancela nos outros aparelhos', async () => {
    const { gw, push, chamada } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    const ack = await gw.onAnswer(morador('ana'), { callId: 'c1' });

    expect(ack.ok).toBe(true);
    expect(ack.grant).toEqual({ token: 't', url: 'wss://lk' });
    expect(chamada.status).toBe('answered');
    expect(push.cancelarChamada).toHaveBeenCalledWith(['ana'], 'c1');
  });

  it('atender cancela o timer: a chamada em curso não vira missed', async () => {
    const { gw, chamada } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });
    await gw.onAnswer(morador('ana'), { callId: 'c1' });

    await jest.advanceTimersByTimeAsync(60_000);

    expect(chamada.status).toBe('answered');
  });

  it('recusar é passar adiante, não derrubar a chamada', async () => {
    const { gw, server } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    await gw.onDecline(morador('ana'), { callId: 'c1' });

    expect(server.eventosEm('user:bruno')).toContain('call:incoming');
    // O entregador só ouve "recusada" quando TODOS recusaram.
    expect(server.eventosEm('sock-entregador')).not.toContain('call:declined');
  });

  it('todos recusarem → declined', async () => {
    const { gw, server, chamada } = montar({ fila: ['ana', 'bruno'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    await gw.onDecline(morador('ana'), { callId: 'c1' });
    await gw.onDecline(morador('bruno'), { callId: 'c1' });

    expect(chamada.status).toBe('declined');
    expect(server.eventosEm('sock-entregador')).toContain('call:declined');
  });

  it('desistir enquanto toca → missed, e o aparelho para de tocar', async () => {
    const { gw, push, chamada } = montar({ fila: ['ana'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    await gw.onEnd({ callId: 'c1' });

    expect(chamada.status).toBe('missed');
    expect(push.cancelarChamada).toHaveBeenCalledWith(['ana'], 'c1');
  });

  it('encerrar depois de atendida → ended, sem push (o socket já cobre)', async () => {
    const { gw, push, chamada } = montar({ fila: ['ana'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });
    await gw.onAnswer(morador('ana'), { callId: 'c1' });
    push.cancelarChamada.mockClear();

    await gw.onEnd({ callId: 'c1' });

    expect(chamada.status).toBe('ended');
    // Quem está em chamada tem socket vivo; um push aqui só faria a tela do
    // aparelho piscar um cancelamento de uma chamada que já acabou.
    expect(push.cancelarChamada).not.toHaveBeenCalled();
  });

  it('encerrar duas vezes não reescreve o desfecho', async () => {
    const { gw, chamada, prisma } = montar({ fila: ['ana'] });
    await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });
    await gw.onAnswer(morador('ana'), { callId: 'c1' });

    await gw.onEnd({ callId: 'c1' });
    const updatesAteAqui = prisma.call.update.mock.calls.length;
    await gw.onEnd({ callId: 'c1' });

    expect(chamada.status).toBe('ended');
    expect(prisma.call.update.mock.calls.length).toBe(updatesAteAqui);
  });

  it('entregador não autenticado não abre chamada', async () => {
    const { gw } = montar();
    const bisbilhoteiro = { id: 's', data: { role: 'resident', userId: 'x', ready: null } } as any;
    const ack = await gw.onStart(bisbilhoteiro, { unitId: 'unit-101', media: 'audio' });
    expect(ack.ok).toBe(false);
  });

  it('conta quantos moradores estão online, para a web mostrar o estado real', async () => {
    const { gw, server } = montar({ fila: ['ana', 'bruno'] });
    server.salasComGente.add('user:ana');

    const ack = await gw.onStart(entregador, { unitId: 'unit-101', media: 'audio' });

    expect(ack.residentsOnline).toBe(1);
  });
});
