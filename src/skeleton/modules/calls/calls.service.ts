import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveKitService } from './livekit.service';
import { CallPushService } from './call-push.service';
import { AnswerCallDto, StartCallDto } from './dto';

/**
 * Máquina de estados da chamada:
 *
 *   ringing ──answer──▶ answered ──end──▶ ended
 *      │  └────decline──▶ declined
 *      └───────timeout──▶ missed
 *
 * Transições só avançam; nunca retrocedem. Cada transição valida o estado atual
 * para evitar corrida (ex.: atender uma chamada já recusada).
 *
 * A mídia A/V não passa por aqui — trafega no LiveKit. Este service coordena
 * estado, tokens e push; o SignalingGateway espelha os eventos em tempo real.
 */
@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LiveKitService,
    private readonly push: CallPushService,
  ) {}

  private room(callId: string) {
    return `call:${callId}`;
  }

  /**
   * Morador ativo inicia uma chamada — para outro morador ou para uma unidade.
   * Retorna o registro Call + o token de mídia do caller.
   */
  async start(
    condominiumId: string,
    caller: { profileId: string; userId: string; name: string },
    dto: StartCallDto,
  ) {
    if (!dto.callee_profile_id && !dto.unit_id) {
      throw new BadRequestException(
        'Informe um morador (callee_profile_id) ou uma unidade (unit_id).',
      );
    }

    // Resolve os usuários-alvo (para o push) — moradores ativos do destino.
    const targetUserIds = await this.resolveTargets(condominiumId, dto);
    if (targetUserIds.length === 0) {
      throw new NotFoundException(
        'Nenhum morador ativo disponível no destino.',
      );
    }

    const call = await this.prisma.call.create({
      data: {
        condominium_id: condominiumId,
        unit_id: dto.unit_id ?? null,
        caller_kind: 'resident',
        caller_id: caller.profileId,
        media: dto.media,
        status: 'ringing',
      },
    });

    const room = this.room(call.id);

    // Token do caller (publica vídeo se a chamada for de vídeo).
    const media = await this.livekit.issueToken({
      room,
      identity: `profile:${caller.profileId}`,
      name: caller.name,
      canPublishVideo: dto.media === 'video',
    });

    // Toca nos devices dos alvos.
    await this.push.ringDevices({
      callId: call.id,
      targetUserIds,
      callerName: caller.name,
      media: dto.media,
      room,
    });

    return { call, media };
  }

  /**
   * Chamada iniciada pelo entregador (web anônima). Difere da interna:
   * caller_kind=delivery, sem caller_id, identidade anônima no LiveKit.
   * Não expõe nem consome dados pessoais do entregador.
   */
  async startDelivery(
    condominiumId: string,
    dto: { unitId: string; media: 'audio' | 'video' },
  ) {
    // Alvos: moradores ativos da unidade.
    const profiles = await this.prisma.profile.findMany({
      where: {
        condominium_id: condominiumId,
        status: 'active',
        role: 'resident',
        unit_memberships: { some: { unit_id: dto.unitId } },
      },
      select: { user_id: true },
    });
    const targetUserIds = profiles.map((p: { user_id: string }) => p.user_id);
    if (targetUserIds.length === 0) {
      throw new NotFoundException('Nenhum morador ativo na unidade.');
    }

    const call = await this.prisma.call.create({
      data: {
        condominium_id: condominiumId,
        unit_id: dto.unitId,
        caller_kind: 'delivery',
        caller_id: null,
        media: dto.media,
        status: 'ringing',
      },
    });

    const room = this.room(call.id);

    // Identidade anônima e efêmera para o entregador.
    const media = await this.livekit.issueToken({
      room,
      identity: `delivery:${call.id}`,
      name: 'Entregador',
      canPublishVideo: dto.media === 'video',
    });

    await this.push.ringDevices({
      callId: call.id,
      targetUserIds,
      callerName: 'Entregador na portaria',
      media: dto.media,
      room,
    });

    return { call, media };
  }

  /** Morador atende. Só válido a partir de `ringing`. */
  async answer(callId: string, answerer: { profileId: string; name: string }, dto: AnswerCallDto) {
    const call = await this.getCall(callId);
    if (call.status !== 'ringing') {
      throw new BadRequestException(
        `Não é possível atender uma chamada em estado "${call.status}".`,
      );
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'answered', answered_at: new Date() },
    });

    // Para o toque nos demais devices do mesmo alvo.
    await this.push.cancelRing({
      callId,
      targetUserIds: [], // preenchido a partir dos alvos originais na impl. real
    });

    const media = await this.livekit.issueToken({
      room: this.room(callId),
      identity: `profile:${answerer.profileId}`,
      name: answerer.name,
      canPublishVideo: dto.media === 'video',
    });

    return { call: updated, media };
  }

  /** Morador recusa. Só válido a partir de `ringing`. */
  async decline(callId: string) {
    const call = await this.getCall(callId);
    if (call.status !== 'ringing') {
      throw new BadRequestException(
        `Não é possível recusar uma chamada em estado "${call.status}".`,
      );
    }
    return this.prisma.call.update({
      where: { id: callId },
      data: { status: 'declined', ended_at: new Date() },
    });
  }

  /**
   * Encerra uma chamada. A partir de `answered` → `ended`;
   * a partir de `ringing` (ninguém atendeu no timeout) → `missed`.
   */
  async end(callId: string, by: { profileId: string }) {
    const call = await this.getCall(callId);

    if (call.status === 'ended' || call.status === 'missed') {
      return call; // idempotente
    }

    // Só quem participa pode encerrar (caller, no MVP).
    if (call.caller_id && call.caller_id !== by.profileId) {
      // moradores-alvo também poderiam encerrar; simplificado no esqueleto
      throw new ForbiddenException('Você não participa desta chamada.');
    }

    const nextStatus = call.status === 'ringing' ? 'missed' : 'ended';
    return this.prisma.call.update({
      where: { id: callId },
      data: { status: nextStatus, ended_at: new Date() },
    });
  }

  /** Chamado pelo scheduler/gateway quando o timeout expira sem atendimento. */
  async markMissed(callId: string) {
    const call = await this.getCall(callId);
    if (call.status !== 'ringing') return call;
    return this.prisma.call.update({
      where: { id: callId },
      data: { status: 'missed', ended_at: new Date() },
    });
  }

  // ========================= HELPERS =========================

  private async getCall(callId: string) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Chamada não encontrada.');
    return call;
  }

  /** userIds dos moradores ativos do destino (unidade ou profile específico). */
  private async resolveTargets(
    condominiumId: string,
    dto: StartCallDto,
  ): Promise<string[]> {
    if (dto.callee_profile_id) {
      const p = await this.prisma.profile.findFirst({
        where: {
          id: dto.callee_profile_id,
          condominium_id: condominiumId,
          status: 'active',
        },
        select: { user_id: true },
      });
      return p ? [p.user_id] : [];
    }

    // Unidade: todos os moradores ativos com membership naquela unidade.
    const profiles = await this.prisma.profile.findMany({
      where: {
        condominium_id: condominiumId,
        status: 'active',
        role: 'resident',
        unit_memberships: { some: { unit_id: dto.unit_id } },
      },
      select: { user_id: true },
    });
    return profiles.map((p: { user_id: string }) => p.user_id);
  }
}
