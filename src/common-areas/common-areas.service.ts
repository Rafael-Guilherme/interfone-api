import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerAccess } from '../condominiums/manager-access.service';
import { CreateCommonAreaDto, ManagementReservationDto, SetAreaBlockDto, UpdateCommonAreaDto } from './dto';
import { diaParaData, hoje, intervaloDoDia, montarCalendario } from './calendar';

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
      max_days_ahead: a.max_days_ahead,
      reservations: a._count.reservations,
    }));
  }

  async create(userId: string, condoId: string, dto: CreateCommonAreaDto) {
    await this.access.assert(userId, condoId, 'areas');
    return this.prisma.commonArea.create({
      data: {
        condominium_id: condoId,
        name: dto.name,
        capacity: dto.capacity ?? null,
        fee_cents: dto.fee_cents ?? null,
        max_days_ahead: dto.max_days_ahead ?? null,
      },
      select: { id: true, name: true, enabled: true, capacity: true, fee_cents: true, max_days_ahead: true },
    });
  }

  async update(userId: string, condoId: string, areaId: string, dto: UpdateCommonAreaDto) {
    await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);
    return this.prisma.commonArea.update({
      where: { id: areaId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.fee_cents !== undefined ? { fee_cents: dto.fee_cents } : {}),
        ...(dto.max_days_ahead !== undefined ? { max_days_ahead: dto.max_days_ahead } : {}),
      },
      select: { id: true, name: true, enabled: true, capacity: true, fee_cents: true, max_days_ahead: true },
    });
  }

  async remove(userId: string, condoId: string, areaId: string) {
    await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);
    await this.prisma.commonArea.delete({ where: { id: areaId } });
    return { ok: true };
  }

  /** Agendamentos (futuros) de uma área — pendentes e confirmados. */
  async reservations(userId: string, condoId: string, areaId: string) {
    await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);
    const rows = await this.prisma.reservation.findMany({
      where: { common_area_id: areaId, status: { in: ['pending', 'confirmed'] }, ends_at: { gte: new Date() } },
      // Pendentes primeiro (é a fila de aprovação), depois por data.
      orderBy: [{ status: 'asc' }, { starts_at: 'asc' }],
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
        status: r.status,
        // Reserva feita pela própria administração não precisa de aprovação.
        is_management: r.profile.role === 'manager' || r.profile.role === 'sub_manager',
      };
    });
  }

  /** Aprova ou recusa uma reserva pendente do morador. */
  async decideReservation(userId: string, condoId: string, areaId: string, resId: string, aprovar: boolean) {
    await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);
    const r = await this.prisma.reservation.findFirst({
      where: { id: resId, common_area_id: areaId },
      select: { id: true, status: true, starts_at: true, ends_at: true },
    });
    if (!r) throw new NotFoundException('Reserva não encontrada.');
    if (r.status !== 'pending') throw new BadRequestException('Esta reserva não está mais pendente.');

    if (!aprovar) {
      await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'cancelled' } });
      return { ok: true, status: 'cancelled' };
    }

    // Ao aprovar, garante que ninguém confirmou outro pedido para o mesmo dia
    // enquanto este aguardava.
    const conflito = await this.prisma.reservation.findFirst({
      where: {
        common_area_id: areaId,
        status: 'confirmed',
        starts_at: { lt: r.ends_at },
        ends_at: { gt: r.starts_at },
        id: { not: r.id },
      },
      select: { id: true },
    });
    if (conflito) throw new ConflictException('Já existe uma reserva confirmada nesse dia.');

    await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'confirmed' } });
    return { ok: true, status: 'confirmed' };
  }

  /**
   * Calendário de ocupação da área para o gestor. Não passa `profileId`: o
   * gestor está olhando a agenda de todo mundo, então "verde = minha reserva"
   * só faz sentido para as reservas dele — resolvido no cliente pelo perfil
   * ativo. Aqui as reservas de gestão saem como 'administracao' (azul).
   */
  async calendar(userId: string, condoId: string, areaId: string) {
    await this.access.assert(userId, condoId);
    await this.owned(condoId, areaId);
    const area = await this.prisma.commonArea.findUnique({
      where: { id: areaId },
      select: { max_days_ahead: true },
    });
    const days = await montarCalendario(this.prisma, areaId, {
      dias: 60,
      maxDaysAhead: area?.max_days_ahead ?? null,
    });
    return { days };
  }

  /**
   * Reserva um dia em nome da administração (azul no calendário) — evento do
   * condomínio, confraternização etc. Sem isto, o status 'administracao' nunca
   * apareceria: o endpoint de reserva do morador exige perfil de morador, e o
   * síndico não tem um.
   */
  async reserveAsManagement(userId: string, condoId: string, areaId: string, dto: ManagementReservationDto) {
    const profile = await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);

    let dia: Date;
    try {
      dia = diaParaData(dto.day);
    } catch {
      throw new BadRequestException('Data inválida.');
    }
    if (dia < hoje()) throw new BadRequestException('Não é possível reservar um dia que já passou.');

    const bloqueado = await this.prisma.areaBlock.findFirst({
      where: { common_area_id: areaId, day: dia },
      select: { id: true },
    });
    if (bloqueado) throw new ConflictException('Esse dia está marcado como indisponível.');

    const { starts, ends } = intervaloDoDia(dia);
    const overlap = await this.prisma.reservation.findFirst({
      // Inclui pendente: senão a administração reservaria por cima de um pedido
      // de morador aguardando aprovação, deixando dois donos para o mesmo dia.
      where: { common_area_id: areaId, status: { in: ['confirmed', 'pending'] }, starts_at: { lt: ends }, ends_at: { gt: starts } },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('Esse dia já está reservado ou aguardando aprovação.');

    // A janela de antecedência (max_days_ahead) não se aplica: ela existe para
    // limitar o morador, não a própria administração.
    return this.prisma.reservation.create({
      data: { common_area_id: areaId, profile_id: profile.id, starts_at: starts, ends_at: ends },
      select: { id: true, starts_at: true, ends_at: true, status: true },
    });
  }

  /** Cancela qualquer reserva da área (do morador ou da administração). */
  async cancelReservation(userId: string, condoId: string, areaId: string, resId: string) {
    await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);
    const r = await this.prisma.reservation.findFirst({
      where: { id: resId, common_area_id: areaId },
      select: { id: true },
    });
    if (!r) throw new NotFoundException('Reserva não encontrada.');
    await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'cancelled' } });
    return { ok: true };
  }

  /** Marca/desmarca um dia como indisponível (cinza no calendário). */
  async setBlock(userId: string, condoId: string, areaId: string, dto: SetAreaBlockDto) {
    await this.access.assert(userId, condoId, 'areas');
    await this.owned(condoId, areaId);

    let dia: Date;
    try {
      dia = diaParaData(dto.day);
    } catch {
      throw new BadRequestException('Data inválida.');
    }

    if (!dto.blocked) {
      await this.prisma.areaBlock.deleteMany({ where: { common_area_id: areaId, day: dia } });
      return { day: dto.day, blocked: false };
    }

    // Bloquear um dia já reservado (ou com pedido pendente) esconderia a reserva
    // do morador sem avisar ninguém; exigimos que ela seja tratada antes.
    const { starts, ends } = intervaloDoDia(dia);
    const reservado = await this.prisma.reservation.findFirst({
      where: {
        common_area_id: areaId,
        status: { in: ['confirmed', 'pending'] },
        starts_at: { lt: ends },
        ends_at: { gt: starts },
      },
      select: { id: true },
    });
    if (reservado) {
      throw new ConflictException('Esse dia já tem reserva. Cancele a reserva antes de bloquear.');
    }

    await this.prisma.areaBlock.upsert({
      where: { common_area_id_day: { common_area_id: areaId, day: dia } },
      create: { common_area_id: areaId, day: dia, reason: dto.reason ?? null },
      update: { reason: dto.reason ?? null },
    });
    return { day: dto.day, blocked: true };
  }

  private async owned(condoId: string, areaId: string) {
    const a = await this.prisma.commonArea.findFirst({ where: { id: areaId, condominium_id: condoId }, select: { id: true } });
    if (!a) throw new NotFoundException('Área comum não encontrada.');
  }
}
