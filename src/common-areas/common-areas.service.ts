import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from '../condominiums/manager-access.service';
import { CreateCommonAreaDto, UpdateCommonAreaDto } from './dto';

/** Áreas comuns (③·6) + consulta de agendamentos. */
@Injectable()
export class CommonAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagerAccess,
  ) {}

  async list(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    const areas = await this.prisma.commonArea.findMany({
      where: { condominium_id: condoId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { reservations: true } } },
    });
    return areas.map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      capacity: a.capacity,
      fee_cents: a.fee_cents,
      reservations: a._count.reservations,
    }));
  }

  async create(userId: string, condoId: string, dto: CreateCommonAreaDto) {
    await this.access.assert(userId, condoId);
    return this.prisma.commonArea.create({
      data: {
        condominium_id: condoId,
        name: dto.name,
        capacity: dto.capacity ?? null,
        fee_cents: dto.fee_cents ?? null,
      },
      select: { id: true, name: true, enabled: true, capacity: true, fee_cents: true },
    });
  }

  async update(userId: string, condoId: string, areaId: string, dto: UpdateCommonAreaDto) {
    await this.access.assert(userId, condoId);
    await this.owned(condoId, areaId);
    return this.prisma.commonArea.update({
      where: { id: areaId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.fee_cents !== undefined ? { fee_cents: dto.fee_cents } : {}),
      },
      select: { id: true, name: true, enabled: true, capacity: true, fee_cents: true },
    });
  }

  async remove(userId: string, condoId: string, areaId: string) {
    await this.access.assert(userId, condoId);
    await this.owned(condoId, areaId);
    await this.prisma.commonArea.delete({ where: { id: areaId } });
    return { ok: true };
  }

  /** Agendamentos (futuros) de uma área. */
  async reservations(userId: string, condoId: string, areaId: string) {
    await this.access.assert(userId, condoId);
    await this.owned(condoId, areaId);
    const rows = await this.prisma.reservation.findMany({
      where: { common_area_id: areaId, status: 'confirmed', ends_at: { gte: new Date() } },
      orderBy: { starts_at: 'asc' },
      include: {
        profile: {
          include: {
            user: { select: { name: true } },
            unit_memberships: { include: { unit: { include: { block: { select: { name: true } } } } } },
          },
        },
      },
    });
    return rows.map((r) => {
      const m = r.profile.unit_memberships[0]?.unit;
      const unit = m ? (m.block ? `Bloco ${m.block.name} · ${m.number}` : m.number) : null;
      return {
        id: r.id,
        resident: r.profile.user.name,
        unit,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
      };
    });
  }

  private async owned(condoId: string, areaId: string) {
    const a = await this.prisma.commonArea.findFirst({ where: { id: areaId, condominium_id: condoId }, select: { id: true } });
    if (!a) throw new NotFoundException('Área comum não encontrada.');
  }
}
