import { DevicesService } from './devices.service';

/**
 * Foco: a quem pertence o aparelho. Errar isso manda a chamada de um morador
 * para o celular de outro — o pior tipo de bug deste módulo, e silencioso.
 */
describe('DevicesService', () => {
  function montar() {
    const prisma = {
      deviceToken: {
        upsert: jest.fn().mockResolvedValue({ id: 'd1', platform: 'android', created_at: new Date() }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    return { svc: new DevicesService(prisma), prisma };
  }

  it('a chave é o token do aparelho, e o dono é reapontado no upsert', async () => {
    const { svc, prisma } = montar();
    await svc.register('bruno', { push_token: 'tok-do-celular', platform: 'android' });

    const [args] = prisma.deviceToken.upsert.mock.calls[0];
    expect(args.where).toEqual({ push_token: 'tok-do-celular' });
    // O mesmo aparelho pode receber o login de outro morador. Sem reapontar o
    // dono, o antigo continuaria recebendo as chamadas de quem usa o celular agora.
    expect(args.update.user_id).toBe('bruno');
  });

  it('registrar de novo não apaga o token de VoIP já guardado', async () => {
    const { svc, prisma } = montar();
    await svc.register('ana', { push_token: 'tok', platform: 'ios' });

    const [args] = prisma.deviceToken.upsert.mock.calls[0];
    expect(args.update).not.toHaveProperty('voip_token');
  });

  it('quando o VoIP vem junto, ele é gravado', async () => {
    const { svc, prisma } = montar();
    await svc.register('ana', { push_token: 'tok', platform: 'ios', voip_token: 'voip-123' });

    const [args] = prisma.deviceToken.upsert.mock.calls[0];
    expect(args.update.voip_token).toBe('voip-123');
    expect(args.create.voip_token).toBe('voip-123');
  });

  it('remover é limitado ao dono do aparelho', async () => {
    const { svc, prisma } = montar();
    await svc.unregister('ana', 'tok-da-ana');

    // Sem o user_id no filtro, qualquer autenticado desregistraria o
    // aparelho de outra pessoa só sabendo o token dela.
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'ana', push_token: 'tok-da-ana' },
    });
  });

  it('remover algo que não existe responde ok com 0', async () => {
    const { svc, prisma } = montar();
    prisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.unregister('ana', 'sumiu')).resolves.toEqual({ ok: true, removed: 0 });
  });
});
