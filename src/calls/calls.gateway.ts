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
 *      │
 *      ├─ decline/timeout na etapa ──▶ próximo da fila (transbordo)
 *      └─ fila esgotada ──▶ declined (todos recusaram) | missed (ninguém atendeu)
 *
 * O toque é sequencial: um morador por vez, na ordem de `call_order`, cada um
 * com RING_STEP_TIMEOUT_MS. Por isso o `call:incoming` vai para `user:<id>` e
 * não para `unit:<id>`.
 *
 * Identidade no handshake:
 *   morador   → auth.role='resident' + auth.token (JWT). Entra nas salas das suas unidades.
 *   entregador→ auth.role='delivery'  + auth.qrToken. Resolve o condo do QR.
 *
 * A mídia A/V trafega no LiveKit (grant emitido aqui); a sinalização só coordena
 * estado. O mapa `rt` guarda o roteamento efêmero de socket por chamada.
 */
/**
 * Transbordo: cada morador da unidade toca por sua vez, na ordem de
 * `UnitMembership.call_order` (empate = mais antigo primeiro). Sem resposta na
 * etapa, passa ao próximo; fila esgotada → missed.
 */
const RING_STEP_MS = Number(process.env.RING_STEP_TIMEOUT_MS ?? 20_000);

type CallMedia = 'audio' | 'video';

interface RuntimeCall {
  callerSocketId: string;
  unitId: string;
  room: string;
  /** user_ids na ordem do transbordo. */
  queue: string[];
  /** índice do morador que está tocando agora. */
  stage: number;
  media: CallMedia;
  /** user_id de quem atendeu, uma vez atendida. */
  answeredBy?: string;
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

    // Fila do transbordo: ordenada por call_order e, no empate, por antiguidade.
    const memberships = await this.prisma.unitMembership.findMany({
      where: {
        unit_id: body.unitId,
        profile: { condominium_id: condoId, status: 'active', role: 'resident' },
      },
      orderBy: [{ call_order: 'asc' }, { created_at: 'asc' }],
      select: { profile: { select: { user_id: true } } },
    });
    // Dedup preservando a ordem (um usuário pode ter mais de um perfil na unidade).
    const queue = [...new Set(memberships.map((m) => m.profile.user_id))];
    if (queue.length === 0) return { ok: false, error: 'Nenhum morador disponível nesta unidade.' };

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

    this.rt.set(call.id, {
      callerSocketId: client.id,
      unitId: body.unitId,
      room,
      queue,
      stage: 0,
      media,
    });
    this.ringStage(call.id);

    const online = queue.filter((uid) => (this.server.adapter.rooms.get(`user:${uid}`)?.size ?? 0) > 0).length;
    this.logger.log(
      `call ${call.id} ringing unit=${body.unitId} fila=${queue.length} online=${online} etapa=1`,
    );

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

    const runtime = this.rt.get(call.id);
    // Com transbordo, só o morador da etapa atual pode atender — sem isso,
    // qualquer morador da unidade poderia sequestrar uma chamada que não é dele.
    if (runtime && runtime.queue[runtime.stage] !== client.data.userId) {
      return { ok: false, error: 'não é a sua vez nesta chamada' };
    }

    await this.prisma.call.update({
      where: { id: call.id },
      data: { status: 'answered', answered_at: new Date() },
    });
    this.clearTimer(call.id);
    if (runtime) runtime.answeredBy = client.data.userId as string;

    if (runtime) this.server.to(runtime.callerSocketId).emit('call:answered', { callId: call.id });
    // Outros devices do MESMO morador param de tocar.
    client.to(`user:${client.data.userId}`).emit('call:cancelled', { callId: call.id });

    this.logger.log(`call ${call.id} answered by ${client.data.userId}`);
    const grant = await this.livekit.issueGrant({
      room: runtime?.room ?? `call:${call.id}`,
      identity: `resident:${client.data.userId}`,
      name: client.data.name,
      canPublishVideo: call.media === 'video',
    });
    return { ok: true, grant };
  }

  /**
   * Morador recusa. Numa fila de transbordo, recusar é "passa para o próximo",
   * não "derruba a chamada" — o entregador só recebe `call:declined` quando
   * todos da fila recusaram.
   */
  @SubscribeMessage('call:decline')
  async onDecline(@ConnectedSocket() client: Socket, @MessageBody() body: { callId: string }) {
    await this.ready(client);
    const rt = this.rt.get(body.callId);
    if (!rt) return { ok: false };
    if (rt.queue[rt.stage] !== client.data?.userId) return { ok: false, error: 'não é a sua vez' };
    this.logger.log(`call ${body.callId} recusada na etapa ${rt.stage + 1}/${rt.queue.length}`);
    await this.advance(body.callId, 'declined');
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
    if (rt) {
      this.server.to(rt.callerSocketId).emit('call:ended', { callId: call.id });
      // Avisa quem atendeu ou, se ainda tocava, quem estava tocando na etapa.
      const target = rt.answeredBy ?? rt.queue[rt.stage];
      if (target) this.server.to(`user:${target}`).emit('call:ended', { callId: call.id });
      this.rt.delete(call.id);
    }
    this.logger.log(`call ${call.id} ${next}`);
    return { ok: true };
  }

  // ----------------------------------------------------------------

  /**
   * Toca no morador da etapa atual e arma o timer que passa ao próximo.
   * Só o morador da vez recebe `call:incoming` — daí a sala ser `user:<id>`
   * e não `unit:<id>`.
   */
  private ringStage(callId: string) {
    const rt = this.rt.get(callId);
    if (!rt) return;
    const userId = rt.queue[rt.stage];
    if (!userId) return;

    this.server.to(`user:${userId}`).emit('call:incoming', {
      callId,
      caller: 'Entregador na portaria',
      media: rt.media,
      room: rt.room,
      stage: rt.stage + 1,
      stages: rt.queue.length,
    });
    rt.timer = setTimeout(() => void this.advance(callId), RING_STEP_MS);
  }

  /**
   * Encerra a etapa atual e vai para o próximo da fila; se acabou a fila,
   * a chamada vira `missed`. `reason` só muda o desfecho quando a fila esgota:
   * recusa explícita de todos → `declined`; ninguém atendeu → `missed`.
   */
  private async advance(callId: string, reason: 'timeout' | 'declined' = 'timeout') {
    const rt = this.rt.get(callId);
    if (!rt) return;
    this.clearTimer(callId);

    // Para o toque no morador da etapa que está saindo (todos os devices dele).
    const leaving = rt.queue[rt.stage];
    if (leaving) this.server.to(`user:${leaving}`).emit('call:cancelled', { callId });

    rt.stage += 1;
    if (rt.stage < rt.queue.length) {
      this.logger.log(`call ${callId} transbordo → etapa ${rt.stage + 1}/${rt.queue.length} (${reason})`);
      this.ringStage(callId);
      return;
    }

    // Fila esgotada.
    const next = reason === 'declined' ? 'declined' : 'missed';
    const call = await this.transitionEnded(callId, next, 'ringing');
    if (call) {
      this.server.to(rt.callerSocketId).emit(next === 'declined' ? 'call:declined' : 'call:missed', { callId });
      this.logger.log(`call ${callId} ${next} (fila de ${rt.queue.length} esgotada)`);
    }
    this.rt.delete(callId);
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
