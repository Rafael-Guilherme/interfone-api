import { ResidentService } from './resident.service';

/**
 * Foco: o sinalizador de novidades do início.
 *
 * A regra é assimétrica de propósito e é isso que se protege aqui: comunicado
 * conta por item lido (tem tela de detalhe), recado conta por data — porque a
 * lista mistura mensagens da web com chamadas perdidas, e só a primeira tem
 * tabela própria para marcar leitura.
 */
describe('ResidentService — sinalizador de novidades', () => {
  function montar(opcoes: { visto?: Date | null; comunicados?: number; mensagens?: number; chamadas?: number } = {}) {
    const profile = { id: 'p1', recados_seen_at: opcoes.visto ?? null };
    const prisma = {
      announcement: { count: jest.fn().mockResolvedValue(opcoes.comunicados ?? 0) },
      missedCallMessage: { count: jest.fn().mockResolvedValue(opcoes.mensagens ?? 0) },
      call: { count: jest.fn().mockResolvedValue(opcoes.chamadas ?? 0) },
      unit: { findMany: jest.fn().mockResolvedValue([{ block_id: 'b1' }, { block_id: null }]) },
      profile: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const access = { assert: jest.fn().mockResolvedValue({ profile, unitIds: ['u1'] }) } as any;
    return { svc: new ResidentService(prisma, access), prisma, access };
  }

  it('soma recados de mensagens e de chamadas perdidas', async () => {
    const { svc } = montar({ mensagens: 2, chamadas: 3, comunicados: 1 });
    await expect(svc.badges('ana', 'condo1')).resolves.toEqual({ comunicados: 1, recados: 5 });
  });

  it('nunca visitou a tela: conta tudo que existe', async () => {
    const { svc, prisma } = montar({ visto: null, mensagens: 4 });
    await svc.badges('ana', 'condo1');

    // Sem marca de leitura, não entra filtro de data — senão o morador novo
    // abriria o app sem sinal nenhum, com recados esperando por ele.
    const [args] = prisma.missedCallMessage.count.mock.calls[0];
    expect(args.where).not.toHaveProperty('created_at');
  });

  it('já visitou: conta só o que chegou depois', async () => {
    const visto = new Date('2026-07-01T10:00:00Z');
    const { svc, prisma } = montar({ visto });
    await svc.badges('ana', 'condo1');

    expect(prisma.missedCallMessage.count.mock.calls[0][0].where.created_at).toEqual({ gt: visto });
    expect(prisma.call.count.mock.calls[0][0].where.started_at).toEqual({ gt: visto });
  });

  it('conta só chamadas que exigem ação — não o histórico inteiro', async () => {
    const { svc, prisma } = montar();
    await svc.badges('ana', 'condo1');

    const [args] = prisma.call.count.mock.calls[0];
    expect(args.where.status).toEqual({ in: ['missed', 'declined'] });
  });

  it('comunicado não lido é o que não tem registro de leitura MINHA', async () => {
    const { svc, prisma } = montar();
    await svc.badges('ana', 'condo1');

    const [args] = prisma.announcement.count.mock.calls[0];
    expect(args.where.reads).toEqual({ none: { profile_id: 'p1' } });
    // Comunicado de bloco só conta para quem é daquele bloco.
    expect(args.where.OR).toEqual([{ scope: 'all' }, { scope: 'block', block_id: { in: ['b1'] } }]);
  });

  it('abrir a tela de recados grava a data de visto', async () => {
    const { svc, prisma } = montar();
    await svc.markRecadosRead('ana', 'condo1');

    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { recados_seen_at: expect.any(Date) },
    });
  });

  it('quem não é morador do condomínio não vê contador', async () => {
    const { svc, access } = montar();
    access.assert.mockRejectedValue(new Error('Você não é morador ativo deste interfone.'));
    await expect(svc.badges('estranho', 'condo1')).rejects.toThrow(/não é morador/);
  });
});
