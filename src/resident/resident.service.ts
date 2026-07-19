import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ResidentAccess } from './resident-access.service';
import { CreateReservationDto, CreateResidentQrDto } from './dto';

/** Jornada do morador: reservas, comunicados, recados e QR de visita. */
@Injectable()
export class ResidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ResidentAccess,
  ) {}

  // -------- reservas de áreas comuns --------
  async areas(userId: string, condoId: string) {
    await this.access.assert(userId, condoId);
    const areas = await this.prisma.commonArea.findMany({
      where: { condominium_id: condoId, enabled: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, capacity: true, fee_cents: true },
    });
    return areas;
  }

  async createReservation(userId: string, condoId: string, dto: CreateReservationDto) {
    const { profile } = await this.access.assert(userId, condoId);
    const starts = new Date(dto.starts_at);
    const ends = new Date(dto.ends_at);
    if (!(starts < ends)) throw new BadRequestException('Horário de término deve ser após o início.');
    if (starts < new Date()) throw new BadRequestException('Não é possível reservar no passado.');

    const area = await this.prisma.commonArea.findFirst({
      where: { id: dto.common_area_id, condominium_id: condoId, enabled: true },
      select: { id: true },
    });
    if (!area) throw new NotFoundException('Área comum indisponível.');

    const overlap = await this.prisma.reservation.findFirst({
      where: {
        common_area_id: dto.common_area_id,
        status: 'confirmed',
        starts_at: { lt: ends },
        ends_at: { gt: starts },
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('Já existe uma reserva nesse horário.');

    const r = await this.prisma.reservation.create({
      data: { common_area_id: dto.common_area_id, profile_id: profile.id, starts_at: starts, ends_at: ends },
      select: { id: true, starts_at: true, ends_at: true, status: true },
    });
    return r;
  }

  async myReservations(userId: string, condoId: string) {
    const { profile } = await this.access.assert(userId, condoId);
    const rows = await this.prisma.reservation.findMany({
      where: { profile_id: profile.id, ends_at: { gte: new Date() } },
      orderBy: { starts_at: 'asc' },
      include: { common_area: { select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, area: r.common_area.name, starts_at: r.starts_at, ends_at: r.ends_at, status: r.status }));
  }

  async cancelReservation(userId: string, condoId: string, resId: string) {
    const { profile } = await this.access.assert(userId, condoId);
    const r = await this.prisma.reservation.findFirst({ where: { id: resId, profile_id: profile.id } });
    if (!r) throw new NotFoundException('Reserva não encontrada.');
    await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'cancelled' } });
    return { ok: true };
  }

  // -------- comunicados --------
  async feed(userId: string, condoId: string) {
    const { profile, unitIds } = await this.access.assert(userId, condoId);
    const units = await this.prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { block_id: true } });
    const myBlocks = [...new Set(units.map((u) => u.block_id).filter(Boolean))] as string[];

    const anns = await this.prisma.announcement.findMany({
      where: {
        condominium_id: condoId,
        OR: [{ scope: 'all' }, { scope: 'block', block_id: { in: myBlocks } }],
      },
      orderBy: { created_at: 'desc' },
      include: { reads: { where: { profile_id: profile.id }, select: { id: true } } },
    });
    return anns.map((a) => ({ id: a.id, title: a.title, body: a.body, created_at: a.created_at, read: a.reads.length > 0 }));
  }

  async markRead(userId: string, condoId: string, annId: string) {
    const { profile } = await this.access.assert(userId, condoId);
    await this.prisma.announcementRead.upsert({
      where: { announcement_id_profile_id: { announcement_id: annId, profile_id: profile.id } },
      update: {},
      create: { announcement_id: annId, profile_id: profile.id },
    });
    return { ok: true };
  }

  // -------- recados (mensagens da web + chamadas perdidas/recusadas) --------
  async recados(userId: string, condoId: string) {
    const { unitIds } = await this.access.assert(userId, condoId);
    const [messages, calls] = await Promise.all([
      this.prisma.missedCallMessage.findMany({
        where: { condominium_id: condoId, OR: [{ unit_id: { in: unitIds } }, { unit_id: null }] },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
      this.prisma.call.findMany({
        where: { condominium_id: condoId, unit_id: { in: unitIds }, status: { in: ['missed', 'declined'] } },
        orderBy: { started_at: 'desc' },
        take: 50,
      }),
    ]);
    const items = [
      ...messages.map((m) => ({ kind: 'message' as const, id: m.id, from: m.visitor_name ?? 'Visitante', text: m.reason ?? '', at: m.created_at })),
      ...calls.map((c) => ({ kind: 'call' as const, id: c.id, from: c.caller_kind === 'delivery' ? 'Entregador/portaria' : 'Morador', text: c.status === 'missed' ? 'Chamada não atendida' : 'Chamada recusada', at: c.started_at })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    return items;
  }

  /**
   * Histórico de chamadas das minhas unidades — todos os desfechos, ao contrário
   * de `recados`, que só traz o que exige ação. `duration_s` só existe quando a
   * chamada foi atendida e encerrada.
   */
  async callHistory(userId: string, condoId: string, limit = 50) {
    const { unitIds } = await this.access.assert(userId, condoId);
    // `Call.unit_id` não tem relação declarada no schema, então o rótulo da
    // unidade vem de uma busca à parte (são poucas unidades por morador).
    const [calls, units] = await Promise.all([
      this.prisma.call.findMany({
        where: { condominium_id: condoId, unit_id: { in: unitIds } },
        orderBy: { started_at: 'desc' },
        take: Math.min(limit, 100),
      }),
      this.prisma.unit.findMany({
        where: { id: { in: unitIds } },
        include: { block: { select: { name: true } } },
      }),
    ]);
    const labels = new Map(
      units.map((u) => [u.id, u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number]),
    );
    return calls.map((c) => ({
      id: c.id,
      from: c.caller_kind === 'delivery' ? 'Entregador/portaria' : 'Morador',
      unit: c.unit_id ? (labels.get(c.unit_id) ?? null) : null,
      media: c.media,
      status: c.status,
      started_at: c.started_at,
      duration_s:
        c.answered_at && c.ended_at
          ? Math.max(0, Math.round((+c.ended_at - +c.answered_at) / 1000))
          : null,
    }));
  }

  // -------- QR do morador (visitas) --------
  async myQrs(userId: string, condoId: string) {
    const { profile } = await this.access.assert(userId, condoId);
    const rows = await this.prisma.qrCode.findMany({
      where: { condominium_id: condoId, kind: 'resident', created_by_id: profile.id },
      orderBy: { created_at: 'desc' },
    });
    const now = new Date();
    return rows.map((q) => ({
      id: q.id,
      label: q.label,
      token: q.token,
      validity_mode: q.validity_mode,
      valid_until: q.valid_until,
      usage_mode: q.usage_mode,
      used_count: q.used_count,
      expired: !q.active || (q.valid_until != null && now > q.valid_until) || (q.usage_mode === 'single' && q.used_count > 0),
    }));
  }

  async createQr(userId: string, condoId: string, dto: CreateResidentQrDto) {
    const { profile } = await this.access.assert(userId, condoId);
    const unitId = profile.unit_memberships[0]?.unit_id ?? null;
    const validity = dto.validity_mode ?? 'fixed';
    let validUntil: Date | null = dto.valid_until ? new Date(dto.valid_until) : null;
    if (validity === 'today') {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      validUntil = end;
    }
    const qr = await this.prisma.qrCode.create({
      data: {
        condominium_id: condoId,
        unit_id: unitId,
        created_by_id: profile.id,
        kind: 'resident',
        label: dto.label,
        token: randomBytes(8).toString('base64url').slice(0, 10),
        validity_mode: validity,
        valid_until: validUntil,
        usage_mode: dto.usage_mode ?? 'unlimited',
        active: true,
      },
      select: { id: true, label: true, token: true },
    });
    return qr;
  }

  async deleteQr(userId: string, condoId: string, qrId: string) {
    const { profile } = await this.access.assert(userId, condoId);
    const qr = await this.prisma.qrCode.findFirst({ where: { id: qrId, created_by_id: profile.id } });
    if (!qr) throw new NotFoundException('QR não encontrado.');
    await this.prisma.qrCode.delete({ where: { id: qr.id } });
    return { ok: true };
  }
}
