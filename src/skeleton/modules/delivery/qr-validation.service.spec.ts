import { GoneException, NotFoundException } from '@nestjs/common';
import { QrValidationService } from './qr-validation.service';

describe('QrValidationService.resolveUsable', () => {
  const baseQr = {
    id: 'qr-1',
    token: 'tok',
    active: true,
    valid_from: null,
    valid_until: null,
    usage_mode: 'unlimited',
    used_count: 0,
    unit_id: null,
    unit: null,
    condominium: { id: 'c1', name: 'Ed. Aurora', status: 'active' },
  };

  function svcWith(qr: any) {
    const prisma = {
      qrCode: { findUnique: jest.fn().mockResolvedValue(qr) },
    } as any;
    return new QrValidationService(prisma);
  }

  it('resolve um QR válido', async () => {
    const out = await svcWith(baseQr).resolveUsable('tok');
    expect(out.id).toBe('qr-1');
  });

  it('404 se não existe ou inativo', async () => {
    await expect(svcWith(null).resolveUsable('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svcWith({ ...baseQr, active: false }).resolveUsable('tok'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('410 se expirado (valid_until no passado)', async () => {
    const qr = { ...baseQr, valid_until: new Date(Date.now() - 1000) };
    await expect(svcWith(qr).resolveUsable('tok')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('410 se ainda não válido (valid_from no futuro)', async () => {
    const qr = { ...baseQr, valid_from: new Date(Date.now() + 3600_000) };
    await expect(svcWith(qr).resolveUsable('tok')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('410 se single já usado', async () => {
    const qr = { ...baseQr, usage_mode: 'single', used_count: 1 };
    await expect(svcWith(qr).resolveUsable('tok')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('single ainda não usado passa', async () => {
    const qr = { ...baseQr, usage_mode: 'single', used_count: 0 };
    const out = await svcWith(qr).resolveUsable('tok');
    expect(out.id).toBe('qr-1');
  });
});

describe('QrValidationService.isExpired', () => {
  const svc = new QrValidationService({} as any);
  it('deriva estado sem tocar o banco', () => {
    expect(
      svc.isExpired({
        active: true,
        valid_until: null,
        usage_mode: 'unlimited',
        used_count: 0,
      }),
    ).toBe(false);
    expect(
      svc.isExpired({
        active: true,
        valid_until: new Date(Date.now() - 1),
        usage_mode: 'unlimited',
        used_count: 0,
      }),
    ).toBe(true);
    expect(
      svc.isExpired({
        active: true,
        valid_until: null,
        usage_mode: 'single',
        used_count: 2,
      }),
    ).toBe(true);
  });
});
