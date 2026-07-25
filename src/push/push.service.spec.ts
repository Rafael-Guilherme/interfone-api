import { PushService } from './push.service';

/**
 * Foco: o que sai para o gateway. O push de chamada tem exigências que o de
 * aviso não tem (prioridade alta, canal próprio, validade curta) e errar
 * qualquer uma delas faz o telefone não tocar — sem erro nenhum no log.
 */
describe('PushService', () => {
  function montar(devices: string[]) {
    const prisma = {
      deviceToken: {
        findMany: jest.fn().mockResolvedValue(devices.map((push_token) => ({ push_token }))),
      },
    } as any;
    const gateway = { send: jest.fn().mockResolvedValue(undefined) };
    const svc = new PushService(prisma, gateway as any);
    return { svc, prisma, gateway };
  }

  const chamada = { callId: 'c1', caller: 'Entregador na portaria', media: 'audio' as const, room: 'call:c1' };

  it('manda para TODOS os aparelhos do morador', async () => {
    const { svc, gateway } = montar(['tok-celular', 'tok-tablet']);
    await svc.notificarChamada('ana', chamada, 25);

    const [mensagens] = gateway.send.mock.calls[0];
    expect(mensagens.map((m: any) => m.to)).toEqual(['tok-celular', 'tok-tablet']);
  });

  it('chamada vai com prioridade alta, canal próprio e validade curta', async () => {
    const { svc, gateway } = montar(['tok']);
    await svc.notificarChamada('ana', chamada, 25);

    const [[msg]] = gateway.send.mock.calls[0];
    // Prioridade normal pode ficar minutos na fila do Android em Doze — a
    // chamada já teria passado para o próximo da fila quando chegasse.
    expect(msg.priority).toBe('high');
    expect(msg.channelId).toBe('calls');
    // Validade curta: entregue depois, viraria notificação de chamada fantasma.
    expect(msg.ttlSeconds).toBe(25);
    expect(msg.data).toMatchObject({ type: 'incoming_call', callId: 'c1', room: 'call:c1' });
  });

  it('cancelamento é silencioso — não alerta de novo quem já atendeu', async () => {
    const { svc, gateway } = montar(['tok']);
    await svc.cancelarChamada(['ana'], 'c1');

    const [[msg]] = gateway.send.mock.calls[0];
    expect(msg.silent).toBe(true);
    expect(msg.data).toEqual({ type: 'call_cancelled', callId: 'c1' });
  });

  it('aviso comum não usa o canal de chamada', async () => {
    const { svc, gateway } = montar(['tok']);
    await svc.notificar(['ana'], 'Aviso', 'Água será desligada às 14h');

    const [[msg]] = gateway.send.mock.calls[0];
    expect(msg.channelId).toBe('default');
    expect(msg.priority).toBeUndefined();
  });

  it('sem aparelho registrado, não chama o gateway', async () => {
    const { svc, gateway } = montar([]);
    await svc.notificarChamada('ana', chamada, 25);
    expect(gateway.send).not.toHaveBeenCalled();
  });

  it('lista de usuários vazia nem consulta o banco', async () => {
    const { svc, prisma } = montar(['tok']);
    await svc.cancelarChamada([], 'c1');
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });

  it('falha no envio não sobe — push nunca pode derrubar a chamada', async () => {
    const { svc, gateway } = montar(['tok']);
    gateway.send.mockRejectedValue(new Error('Expo fora do ar'));
    // Quem chama isto está no meio de um `call:start`; uma exceção aqui mataria
    // a chamada de quem está com o app aberto, que nem depende de push.
    await expect(svc.notificarChamada('ana', chamada, 25)).resolves.toBeUndefined();
  });
});
