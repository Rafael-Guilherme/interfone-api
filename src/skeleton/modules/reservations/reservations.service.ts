import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateCommonAreaDto,
  CreateReservationDto,
  UpdateCommonAreaDto,
} from './dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ========================= ÁREAS COMUNS =========================

  /** Morador vê só as habilitadas; gestor vê todas. */
  listAreas(condominiumId: string, opts: { includeDisabled: boolean }) {
    return this.prisma.commonArea.findMany({
      where: {
        condominium_id: condominiumId,
        ...(opts.includeDisabled ? {} : { enabled: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  createArea(condominiumId: string, dto: CreateCommonAreaDto) {
    return this.prisma.commonArea.create({
      data: {
        condominium_id: condominiumId,
        name: dto.name,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async updateArea(
    condominiumId: string,
    areaId: string,
    dto: UpdateCommonAreaDto,
  ) {
    await this.assertAreaInCondo(areaId, condominiumId);
    return this.prisma.commonArea.update({
      where: { id: areaId },
      data: { name: dto.name, enabled: dto.enabled },
    });
  }

  async deleteArea(condominiumId: string, areaId: string) {
    await this.assertAreaInCondo(areaId, condominiumId);
    // Cascade em Reservation via schema (onDelete: Cascade).
    await this.prisma.commonArea.delete({ where: { id: areaId } });
  }

  // ========================= RESERVAS =========================

  /**
   * scope=mine → reservas do próprio morador.
   * scope=all  → agenda de todas as áreas do condo (para exibir ocupação).
   */
  listReservations(
    condominiumId: string,
    profileId: string,
    scope: 'mine' | 'all',
  ) {
    return this.prisma.reservation.findMany({
      where: {
        common_area: { condominium_id: condominiumId },
        ...(scope === 'mine' ? { profile_id: profileId } : {}),
        status: 'confirmed',
      },
      include: { common_area: { select: { id: true, name: true } } },
      orderBy: { starts_at: 'asc' },
    });
  }

  async createReservation(
    condominiumId: string,
    profileId: string,
    dto: CreateReservationDto,
  ) {
    const starts = new Date(dto.starts_at);
    const ends = new Date(dto.ends_at);

    if (ends <= starts) {
      throw new BadRequestException(
        'O horário de término deve ser depois do início.',
      );
    }
    if (starts < new Date()) {
      throw new BadRequestException('Não é possível reservar no passado.');
    }

    // Área precisa existir, pertencer ao condo e estar habilitada.
    const area = await this.prisma.commonArea.findFirst({
      where: {
        id: dto.common_area_id,
        condominium_id: condominiumId,
        enabled: true,
      },
      select: { id: true },
    });
    if (!area) {
      throw new NotFoundException(
        'Área comum não encontrada ou indisponível para reserva.',
      );
    }

    // Validação de overlap (na aplicação — sem constraint no banco ainda).
    // Sobreposição de intervalos [a,b) e [c,d): a < d && c < b.
    const clash = await this.prisma.reservation.findFirst({
      where: {
        common_area_id: dto.common_area_id,
        status: 'confirmed',
        starts_at: { lt: ends },
        ends_at: { gt: starts },
      },
      select: { id: true, starts_at: true, ends_at: true },
    });
    if (clash) {
      throw new ConflictException(
        'Já existe uma reserva confirmada nesse horário para esta área.',
      );
    }

    return this.prisma.reservation.create({
      data: {
        common_area_id: dto.common_area_id,
        profile_id: profileId,
        starts_at: starts,
        ends_at: ends,
        status: 'confirmed',
      },
    });
  }

  /** Cancela — apenas o dono da reserva. */
  async cancelReservation(reservationId: string, profileId: string) {
    const res = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, profile_id: true, status: true },
    });
    if (!res) throw new NotFoundException('Reserva não encontrada.');
    if (res.profile_id !== profileId) {
      throw new ForbiddenException('Você só pode cancelar suas reservas.');
    }
    if (res.status === 'cancelled') return res; // idempotente

    return this.prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'cancelled' },
    });
  }

  // ========================= HELPERS =========================

  private async assertAreaInCondo(areaId: string, condominiumId: string) {
    const area = await this.prisma.commonArea.findFirst({
      where: { id: areaId, condominium_id: condominiumId },
      select: { id: true },
    });
    if (!area) throw new NotFoundException('Área comum não encontrada.');
  }
}
