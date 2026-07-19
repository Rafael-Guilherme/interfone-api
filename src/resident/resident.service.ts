import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ResidentAccess } from './resident-access.service';
import { CreateReservationDto, CreateResidentQrDto } from './dto';
import {
  diaParaData,
  hoje,
  intervaloDoDia,
  montarCalendario,
  ultimoDiaReservavel,
} from '../common-areas/calendar';

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
      select: { id: true, name: true, capacity: true, fee_cents: true, max_days_ahead: true },
    });
    return areas;
  }

  /** Calendário da área: o morador escolhe o dia a partir daqui. */
  async areaCalendar(userId: string, condoId: string, areaId: string, dias = 60) {
    const { profile } = await this.access.assert(userId, condoId);
    const area = await this.prisma.commonArea.findFirst({
      where: { id: areaId, condominium_id: condoId, enabled: true },
      select: { id: true, name: true, max_days_ahead: true },
    });
    if (!area) throw new NotFoundException('Área comum indisponível.');
    const days = await montarCalendario(this.prisma, area.id, {
      dias,
      profileId: profile.id,
      maxDaysAhead: area.max_days_ahead,
    });
    return { area: { id: area.id, name: area.name, max_days_ahead: area.max_days_ahead }, days };
  }

  /**
   * Reserva pelo dia inteiro. O antigo formato com hora/duração caía na guarda
   * de "não reservar no passado" sempre que o horário padrão da tela já tinha
   * passado — o morador simplesmente não conseguia reservar à tarde.
   */
  async createReservation(userId: string, condoId: string, dto: CreateReservationDto) {
    const { profile } = await this.access.assert(userId, condoId);

    let dia: Date;
    try {
      dia = diaParaData(dto.day);
    } catch {
      throw new BadRequestException('Data inválida.');
    }
    // Comparação por DIA, não por instante: reservar "hoje" é válido durante
    // todo o dia de hoje.
    if (dia < hoje()) throw new BadRequestException('Não é possível reservar um dia que já passou.');

    const area = await this.prisma.commonArea.findFirst({
      where: { id: dto.common_area_id, condominium_id: condoId, enabled: true },
      select: { id: true, max_days_ahead: true },
    });
    if (!area) throw new NotFoundException('Área comum indisponível.');

    const limite = ultimoDiaReservavel(area.max_days_ahead);
    if (limite && dia > limite) {
      throw new BadRequestException(
        `Esta área só pode ser reservada com até ${area.max_days_ahead} dias de antecedência.`,
      );
    }

    const bloqueio = await this.prisma.areaBlock.findFirst({
      where: { common_area_id: area.id, day: dia },
      select: { reason: true },
    });
    if (bloqueio) {
      throw new ConflictException(
        bloqueio.reason
          ? `Área indisponível nesse dia: ${bloqueio.reason}`
          : 'Área indisponível nesse dia.',
      );
    }

    const { starts, ends } = intervaloDoDia(dia);
    const overlap = await this.prisma.reservation.findFirst({
      where: {
        common_area_id: area.id,
        // Pendente também segura o dia — não deixa dois moradores pedirem o mesmo.
        status: { in: ['confirmed', 'pending'] },
        starts_at: { lt: ends },
        ends_at: { gt: starts },
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('Esse dia já está reservado ou aguardando aprovação.');

    // Reserva do morador nasce PENDENTE: o gestor precisa aprovar.
    const r = await this.prisma.reservation.create({
      data: { common_area_id: area.id, profile_id: profile.id, starts_at: starts, ends_at: ends, status: 'pending' },
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

  // -------- fila de transbordo da unidade --------

  /**
   * Quem manda na fila é o morador ATIVO mais antigo da unidade — "a primeira
   * pessoa cadastrada naquela unidade decide a fila". Empate de `created_at`
   * (import em lote, p.ex.) desempata por id, para a resposta ser estável.
   */
  private async filaDaUnidade(unitId: string) {
    const membros = await this.prisma.unitMembership.findMany({
      where: { unit_id: unitId, profile: { status: 'active', role: 'resident' } },
      include: { profile: { include: { user: { select: { id: true, name: true } } } } },
      orderBy: [{ call_order: 'asc' }, { created_at: 'asc' }],
    });
    const maisAntigo = [...membros].sort(
      (a, b) => +a.created_at - +b.created_at || a.id.localeCompare(b.id),
    )[0];
    return { membros, donoProfileId: maisAntigo?.profile_id ?? null };
  }

  /** Unidades do morador + a fila de cada uma, com quem pode editar. */
  async callQueue(userId: string, condoId: string) {
    const { profile, unitIds } = await this.access.assert(userId, condoId);
    const unidades = await this.prisma.unit.findMany({
      where: { id: { in: unitIds } },
      include: { block: { select: { name: true } } },
    });

    return Promise.all(
      unidades.map(async (u) => {
        const { membros, donoProfileId } = await this.filaDaUnidade(u.id);
        return {
          unit_id: u.id,
          unidade: u.block ? `Bloco ${u.block.name} · ${u.number}` : u.number,
          // Só o dono edita; os demais veem a fila em modo leitura.
          posso_editar: donoProfileId === profile.id,
          moradores: membros.map((m, i) => ({
            profile_id: m.profile_id,
            nome: m.profile.user.name,
            sou_eu: m.profile_id === profile.id,
            ordem: i + 1,
            na_fila: m.in_queue,
          })),
        };
      }),
    );
  }

  /**
   * Grava a fila: quem participa e em que ordem. Recebe os profile_ids na ordem
   * desejada + a lista de quem fica de fora.
   */
  async setCallQueue(
    userId: string,
    condoId: string,
    unitId: string,
    entradas: { profile_id: string; na_fila: boolean }[],
  ) {
    const { profile, unitIds } = await this.access.assert(userId, condoId);
    if (!unitIds.includes(unitId)) throw new NotFoundException('Unidade não encontrada.');

    const { membros, donoProfileId } = await this.filaDaUnidade(unitId);
    if (donoProfileId !== profile.id) {
      throw new ForbiddenException('Só o primeiro morador cadastrado na unidade pode alterar a fila.');
    }

    const validos = new Set(membros.map((m) => m.profile_id));
    const desconhecido = entradas.find((e) => !validos.has(e.profile_id));
    if (desconhecido) throw new BadRequestException('Morador não pertence a esta unidade.');
    if (entradas.length !== membros.length) {
      throw new BadRequestException('Envie todos os moradores da unidade.');
    }
    // Uma unidade sem ninguém na fila nunca tocaria — o interfone ficaria mudo.
    if (!entradas.some((e) => e.na_fila)) {
      throw new BadRequestException('Ao menos um morador precisa estar na fila.');
    }

    await this.prisma.$transaction(
      entradas.map((e, i) =>
        this.prisma.unitMembership.updateMany({
          where: { unit_id: unitId, profile_id: e.profile_id },
          data: { call_order: i, in_queue: e.na_fila },
        }),
      ),
    );
    return { ok: true };
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
