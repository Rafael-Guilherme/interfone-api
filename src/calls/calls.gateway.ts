import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import { DeliveryService } from '../delivery/delivery.service';

/**
 * Signaling do fluxo web (entregador) ↔ app (morador), respaldado no Postgres.
 *
 *   ringing ──answer──▶ answered ──end──▶ ended
 *      │  └────decline──▶ declined
 *      └───────timeout(45s)──▶ missed
 *
 * Identidade no handshake:
 *   morador   → auth.role='resident' + auth.token (JWT). Entra nas salas das suas unidades.
 *   entregador→ auth.role='delivery'  + auth.qrToken. Resolve o condo do QR.
 *
 * A mídia A/V trafega no LiveKit (grant emitido aqui); a sinalização só coordena
 * estado. O mapa `rt` guarda o roteamento efêmero de socket por chamada.
 */
const RING_TIMEOUT_MS = 45_000;

type CallMedia = 'audio' | 'video';

interface RuntimeCall {
  callerSocketId: string;
  unitId: string;
  room: string;
  timer?: NodeJS.Timeout;
}

@WebSocketGateway({ namespace: '/calls', cors: { origin: true, credentials: true } })
export class CallsGateway implements OnGatewayConnection {
  @WebSocketServer() private server!: Namespace;
  private readonly logger = new Logger(CallsGateway.name);
  private readonly rt = new Map<string, RuntimeCall>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LiveKitService,
    private readonly delivery: DeliveryService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * O handshake é assíncrono (verifica JWT / resolve QR no banco). Guardamos a
   * promessa em `client.data.ready` de forma SÍNCRONA, para que um `call:start`
   * que chegue logo após o `connect` do cliente possa aguardá-la antes de rodar.
   */
  handleConnection(client: Socket) {
    client.data.ready = this.setup(client);
  }

  private async setup(client: Socket) {
    const auth = { ...client.handshake.auth, ...client.handshake.query } as Record<string, string>;
    try {
      if (auth.role === 'resident') {
        const payload = await this.jwt.verifyAsync(auth.token);
        const userId = payload.sub as string;
        const profiles = await this.prisma.profile.findMany({
          where: { user_id: userId, status: 'active' },
          include: { unit_memberships: { select: { unit_id: true } } },
        });
        const unitIds = [...new Set(profiles.flatMap((p) => p.unit_memberships.map((m) => m.unit_id)))];
        Object.assign(client.data, { role: 'resident', userId, name: payload.email, unitIds });
        client.join(`user:${userId}`);
        for (const uid of unitIds) client.join(`unit:${uid}`);
        this.logger.debug(`+ resident ${userId} units=[${unitIds.join(',')}]`);
      } else {
        const qr = await this.delivery.resolveQr(auth.qrToken ?? auth.token);
        Object.assign(client.data, { role: 'delivery', condoId: qr.condominium.id });
        this.logger.debug(`+ delivery condo=${qr.condominium.id}`);
      }
    } catch (e) {
      this.logger.warn(`handshake rejeitado: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  private async ready(client: Socket) {
    await client.data?.ready;
  }

  /** Entregador inicia a chamada para uma unidade. Retorno = ACK ao cliente. */
  @SubscribeMessage('call:start')
  async onStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { unitId: string; media: CallMedia },
  ) {
    await this.ready(client);
    if (client.data?.role !== 'delivery') return { ok: false, error: 'não autorizado' };
    const condoId = client.data.condoId as string;

    const unit = await this.prisma.unit.findFirst({
      where: { id: body.unitId, condominium_id: condoId },
      select: { id: true },
    });
    if (!unit) return { ok: false, error: 'Unidade inválida.' };

    const targets = await this.prisma.profile.findMany({
      where: {
        condominium_id: condoId,
        status: 'active',
        role: 'resident',
        unit_memberships: { some: { unit_id: body.unitId } },
      },
      select: { user_id: true },
    });
    if (targets.length === 0) return { ok: false, error: 'Nenhum morador disponível nesta unidade.' };

    const media: CallMedia = body.media === 'video' ? 'video' : 'audio';
    const call = await this.prisma.call.create({
      data: {
        condominium_id: condoId,
        unit_id: body.unitId,
        caller_kind: 'delivery',
        media,
        status: 'ringing',
      },
    });
    const room = `call:${call.id}`;
    const unitRoom = `unit:${body.unitId}`;

    const timer = setTimeout(() => void this.expire(call.id), RING_TIMEOUT_MS);
    this.rt.set(call.id, { callerSocketId: client.id, unitId: body.unitId, room, timer });

    this.server.to(unitRoom).emit('call:incoming', {
      callId: call.id,
      caller: 'Entregador na portaria',
      media,
      room,
    });

    const online = this.server.adapter.rooms.get(unitRoom)?.size ?? 0;
    this.logger.log(`call ${call.id} ringing unit=${body.unitId} targets=${targets.length} online=${online}`);

    const grant = await this.livekit.issueGrant({
      room,
      identity: `delivery:${call.id}`,
      name: 'Entregador',
      canPublishVideo: media === 'video',
    });
    return { ok: true, callId: call.id, room, residentsOnline: online, grant };
  }

  /** Morador atende. */
  @SubscribeMessage('call:answer')
  async onAnswer(@ConnectedSocket() client: Socket, @MessageBody() body: { callId: string }) {
    await this.ready(client);
    if (client.data?.role !== 'resident') return { ok: false, error: 'não autorizado' };
    const call = await this.prisma.call.findUnique({ where: { id: body.callId } });
    if (!call || call.status !== 'ringing') return { ok: false, error: 'estado inválido' };

    await this.prisma.call.update({
      where: { id: call.id },
      data: { status: 'answered', answered_at: new Date() },
    });
    const runtime = this.rt.get(call.id);
    this.clearTimer(call.id);

    if (runtime) this.server.to(runtime.callerSocketId).emit('call:answered', { callId: call.id });
    // Outros devices da unidade param de tocar.
    client.to(`unit:${call.unit_id}`).emit('call:cancelled', { callId: call.id });

    this.logger.log(`call ${call.id} answered by ${client.data.userId}`);
    const grant = await this.livekit.issueGrant({
      room: runtime?.room ?? `call:${call.id}`,
      identity: `resident:${client.data.userId}`,
      name: client.data.name,
      canPublishVideo: call.media === 'video',
    });
    return { ok: true, grant };
  }

  /** Morador recusa. */
  @SubscribeMessage('call:decline')
  async onDecline(@MessageBody() body: { callId: string }) {
    const rt = this.rt.get(body.callId);
    const call = await this.transitionEnded(body.callId, 'declined');
    if (!call) return { ok: false };
    if (rt) this.server.to(rt.callerSocketId).emit('call:declined', { callId: call.id });
    this.server.to(`unit:${call.unit_id}`).emit('call:cancelled', { callId: call.id });
    this.rt.delete(call.id);
    this.logger.log(`call ${call.id} declined`);
    return { ok: true };
  }

  /** Qualquer lado encerra. */
  @SubscribeMessage('call:end')
  async onEnd(@MessageBody() body: { callId: string }) {
    const existing = await this.prisma.call.findUnique({ where: { id: body.callId } });
    if (!existing) return { ok: false };
    const next = existing.status === 'ringing' ? 'missed' : 'ended';
    const rt = this.rt.get(body.callId);
    const call = await this.transitionEnded(body.callId, next);
    if (!call) return { ok: false };
    if (rt) this.server.to(rt.callerSocketId).emit('call:ended', { callId: call.id });
    this.server.to(`unit:${call.unit_id}`).emit('call:ended', { callId: call.id });
    this.rt.delete(call.id);
    this.logger.log(`call ${call.id} ${next}`);
    return { ok: true };
  }

  // ----------------------------------------------------------------

  private async expire(callId: string) {
    const rt = this.rt.get(callId);
    const call = await this.transitionEnded(callId, 'missed', 'ringing');
    if (!call) return;
    if (rt) this.server.to(rt.callerSocketId).emit('call:missed', { callId });
    this.server.to(`unit:${call.unit_id}`).emit('call:cancelled', { callId });
    this.rt.delete(callId);
    this.logger.log(`call ${callId} missed (timeout)`);
  }

  /**
   * Transição terminal com guarda de estado. `requireStatus` restringe o estado
   * de partida (evita, ex., encerrar duas vezes ou expirar já atendida).
   */
  private async transitionEnded(
    callId: string,
    next: 'declined' | 'ended' | 'missed',
    requireStatus?: 'ringing',
  ) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) return null;
    if (['ended', 'declined', 'missed'].includes(call.status)) return null;
    if (requireStatus && call.status !== requireStatus) return null;

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: next, ended_at: new Date() },
    });
    this.clearTimer(callId); // rt.delete fica a cargo do chamador, após rotear o evento
    return updated;
  }

  private clearTimer(callId: string) {
    const t = this.rt.get(callId)?.timer;
    if (t) clearTimeout(t);
  }
}
