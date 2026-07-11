import { ConflictException, BadRequestException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';

/**
 * Testa a lógica que importa: overlap e validação de intervalo.
 * O PrismaService é mockado — nenhum banco é tocado.
 */
describe('ReservationsService.createReservation', () => {
  const future = (h: number) =>
    new Date(Date.now() + h * 3600_000).toISOString();

  function makePrisma(overrides: any = {}) {
    return {
      commonArea: {
        findFirst: jest.fn().mockResolvedValue({ id: 'area-1' }),
      },
      reservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'res-1',
          ...data,
        })),
      },
      ...overrides,
    } as any;
  }

  it('cria quando não há conflito', async () => {
    const prisma = makePrisma();
    const svc = new ReservationsService(prisma);
    const out = await svc.createReservation('condo-1', 'prof-1', {
      common_area_id: 'area-1',
      starts_at: future(1),
      ends_at: future(2),
    });
    expect(out.id).toBe('res-1');
    expect(prisma.reservation.create).toHaveBeenCalledTimes(1);
  });

  it('rejeita overlap com 409', async () => {
    const prisma = makePrisma({
      reservation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'clash' }),
        create: jest.fn(),
      },
    });
    const svc = new ReservationsService(prisma);
    await expect(
      svc.createReservation('condo-1', 'prof-1', {
        common_area_id: 'area-1',
        starts_at: future(1),
        ends_at: future(2),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('rejeita término <= início', async () => {
    const svc = new ReservationsService(makePrisma());
    await expect(
      svc.createReservation('condo-1', 'prof-1', {
        common_area_id: 'area-1',
        starts_at: future(2),
        ends_at: future(1),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita reserva no passado', async () => {
    const svc = new ReservationsService(makePrisma());
    await expect(
      svc.createReservation('condo-1', 'prof-1', {
        common_area_id: 'area-1',
        starts_at: future(-2),
        ends_at: future(-1),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
