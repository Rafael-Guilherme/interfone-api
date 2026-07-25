import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

/**
 * Foco: a cerca virtual e a validade do QR.
 *
 * É a única barreira entre um QR fotografado e a possibilidade de tocar o
 * interfone de qualquer lugar do mundo. E é matemática: um sinal trocado na
 * haversine passa despercebido em teste manual feito sempre no mesmo lugar.
 */
describe('DeliveryService — QR e cerca virtual', () => {
  const condoBase = {
    id: 'condo1',
    name: 'Residencial Demo',
    status: 'active',
    latitude: -23.55052,
    longitude: -46.633309,
    geo_radius_m: 250,
  };

  function montar(qr: any) {
    const prisma = {
      qrCode: { findUnique: jest.fn().mockResolvedValue(qr) },
      unit: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', number: '101', block: { name: 'A' } }]) },
    } as any;
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('passe.jwt'),
      verifyAsync: jest.fn(),
    } as any;
    return { svc: new DeliveryService(prisma, jwt), prisma, jwt };
  }

  const qrValido = (extra: any = {}) => ({
    id: 'qr1',
    active: true,
    unit_id: null,
    unit: null,
    valid_from: null,
    valid_until: null,
    condominium: condoBase,
    ...extra,
  });

  describe('validade do QR', () => {
    it('token desconhecido não resolve', async () => {
      const { svc } = montar(null);
      await expect(svc.resolve('sumiu')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('QR desativado não resolve', async () => {
      const { svc } = montar(qrValido({ active: false }));
      await expect(svc.resolve('qr')).rejects.toThrow(/inválido/);
    });

    it('QR de condomínio suspenso não resolve', async () => {
      const { svc } = montar(qrValido({ condominium: { ...condoBase, status: 'suspended' } }));
      await expect(svc.resolve('qr')).rejects.toThrow(/inválido/);
    });

    it('QR com prazo vencido não resolve', async () => {
      const { svc } = montar(qrValido({ valid_until: new Date(Date.now() - 1000) }));
      await expect(svc.resolve('qr')).rejects.toThrow(/expirado/);
    });

    it('QR agendado para depois ainda não resolve', async () => {
      const { svc } = montar(qrValido({ valid_from: new Date(Date.now() + 86_400_000) }));
      await expect(svc.resolve('qr')).rejects.toThrow(/ainda não válido/);
    });
  });

  describe('cerca virtual', () => {
    it('sem posição, devolve o pedido de localização e NENHUMA unidade', async () => {
      const { svc } = montar(qrValido());
      const r = await svc.resolve('qr');

      expect(r.geo).toEqual({ required: true, radius_m: 250 });
      // A lista de unidades é informação do condomínio: não pode vazar para
      // quem ainda não provou estar na porta.
      expect(r.units).toEqual([]);
      expect(r).not.toHaveProperty('geo_pass');
    });

    it('dentro do raio, libera as unidades e emite o passe', async () => {
      const { svc } = montar(qrValido());
      const r: any = await svc.resolve('qr', { lat: -23.55052, lng: -46.633309 });

      expect(r.units).toHaveLength(1);
      expect(r.geo).toMatchObject({ verified: true });
      // Sem o passe, dava para pular a verificação conectando direto no socket.
      expect(r.geo_pass).toBe('passe.jwt');
    });

    it('longe do condomínio, recusa dizendo a distância', async () => {
      const { svc } = montar(qrValido());
      // ~2,6 km do centro cadastrado.
      await expect(svc.resolve('qr', { lat: -23.561414, lng: -46.655881 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('condomínio sem coordenada cadastrada não exige geo', async () => {
      const { svc } = montar(
        qrValido({ condominium: { ...condoBase, latitude: null, longitude: null } }),
      );
      const r = await svc.resolve('qr');

      // Exigir posição sem ter centro cadastrado bloquearia todo mundo num
      // condomínio que nunca configurou raio.
      expect(r.geo).toEqual({ required: false });
      expect(r.units).toHaveLength(1);
    });

    it('raio zerado também não exige geo', async () => {
      const { svc } = montar(qrValido({ condominium: { ...condoBase, geo_radius_m: 0 } }));
      const r = await svc.resolve('qr');
      expect(r.geo).toEqual({ required: false });
    });
  });

  describe('passe do socket', () => {
    it('aceita o passe do próprio condomínio', async () => {
      const { svc, jwt } = montar(qrValido());
      jwt.verifyAsync.mockResolvedValue({ scope: 'geo_pass', condo: 'condo1' });
      await expect(svc.validarPasse('condo1', 'p')).resolves.toBe(true);
    });

    it('recusa passe emitido para OUTRO condomínio', async () => {
      const { svc, jwt } = montar(qrValido());
      jwt.verifyAsync.mockResolvedValue({ scope: 'geo_pass', condo: 'outro-condo' });
      await expect(svc.validarPasse('condo1', 'p')).resolves.toBe(false);
    });

    it('recusa token de outro escopo (um access token, por exemplo)', async () => {
      const { svc, jwt } = montar(qrValido());
      jwt.verifyAsync.mockResolvedValue({ sub: 'user1' });
      await expect(svc.validarPasse('condo1', 'p')).resolves.toBe(false);
    });

    it('recusa passe ausente ou inválido', async () => {
      const { svc, jwt } = montar(qrValido());
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      await expect(svc.validarPasse('condo1', undefined)).resolves.toBe(false);
    });
  });
});
