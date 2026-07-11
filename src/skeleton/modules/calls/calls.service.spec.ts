import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CallsService } from './calls.service';

/**
 * Foco: transições de estado válidas e inválidas. LiveKit e Push mockados.
 */
describe('CallsService — máquina de estados', () => {
  const livekit = {
    issueToken: jest.fn().mockResolvedValue({ token: 'jwt', url: 'wss://lk' }),
  } as any;
  const push = {
    ringDevices: jest.fn().mockResolvedValue(undefined),
    cancelRing: jest.fn().mockResolvedValue(undefined),
  } as any;

  function prismaWith(call: any) {
    return {
      call: {
        findUnique: jest.fn().mockResolvedValue(call),
        update: jest
          .fn()
          .mockImplementation(({ data }) => ({ ...call, ...data })),
      },
    } as any;
  }

  it('answer só é válido a partir de ringing', async () => {
    const prisma = prismaWith({ id: 'c1', status: 'answered' });
    const svc = new CallsService(prisma, livekit, push);
    await expect(
      svc.answer('c1', { profileId: 'p1', name: 'Ana' }, { media: 'audio' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answer a partir de ringing → answered + token', async () => {
    const prisma = prismaWith({ id: 'c1', status: 'ringing' });
    const svc = new CallsService(prisma, livekit, push);
    const out = await svc.answer(
      'c1',
      { profileId: 'p1', name: 'Ana' },
      { media: 'video' },
    );
    expect(out.call.status).toBe('answered');
    expect(out.media.token).toBe('jwt');
  });

  it('end a partir de ringing → missed (ninguém atendeu)', async () => {
    const prisma = prismaWith({
      id: 'c1',
      status: 'ringing',
      caller_id: 'p1',
    });
    const svc = new CallsService(prisma, livekit, push);
    const out = await svc.end('c1', { profileId: 'p1' });
    expect(out.status).toBe('missed');
  });

  it('end a partir de answered → ended', async () => {
    const prisma = prismaWith({
      id: 'c1',
      status: 'answered',
      caller_id: 'p1',
    });
    const svc = new CallsService(prisma, livekit, push);
    const out = await svc.end('c1', { profileId: 'p1' });
    expect(out.status).toBe('ended');
  });

  it('end é idempotente em estado terminal', async () => {
    const prisma = prismaWith({ id: 'c1', status: 'ended', caller_id: 'p1' });
    const svc = new CallsService(prisma, livekit, push);
    const out = await svc.end('c1', { profileId: 'p1' });
    expect(out.status).toBe('ended');
    expect(prisma.call.update).not.toHaveBeenCalled();
  });

  it('getCall inexistente → 404', async () => {
    const prisma = prismaWith(null);
    const svc = new CallsService(prisma, livekit, push);
    await expect(svc.decline('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
