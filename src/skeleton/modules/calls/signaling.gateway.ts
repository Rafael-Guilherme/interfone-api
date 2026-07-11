import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Signaling em tempo real. NÃO transporta mídia (isso é o LiveKit) — só
 * espelha transições de estado para clientes que já estão com o app aberto,
 * complementando o push (que cobre o app fechado).
 *
 * Cada usuário entra numa sala pessoal `user:<userId>` na conexão; o service
 * emite eventos de chamada para essas salas via `notifyUser`.
 *
 * Autenticação do socket: o handshake carrega o access token (auth.token);
 * um WsAuthGuard (não incluído no esqueleto) resolve o userId antes do connect.
 */
@WebSocketGateway({
  namespace: '/calls',
  cors: { origin: true },
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(SignalingGateway.name);

  handleConnection(client: Socket) {
    const userId = this.userIdFromHandshake(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.join(`user:${userId}`);
    this.logger.debug(`socket connected user=${userId}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`socket disconnected ${client.id}`);
  }

  /** Cliente sinaliza que está pronto na room de mídia (opcional, para UX). */
  @SubscribeMessage('call:ready')
  onReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: string },
  ) {
    this.logger.debug(`call:ready ${data.callId} from ${client.id}`);
  }

  // ---- API interna, chamada pelo CallsService ----

  notifyUser(userId: string, event: CallEvent, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  notifyUsers(userIds: string[], event: CallEvent, payload: unknown) {
    for (const id of userIds) this.notifyUser(id, event, payload);
  }

  private userIdFromHandshake(client: Socket): string | null {
    // Preenchido pelo WsAuthGuard; placeholder no esqueleto.
    return (client.data?.userId as string) ?? null;
  }
}

export type CallEvent =
  | 'call:incoming'
  | 'call:answered'
  | 'call:declined'
  | 'call:ended'
  | 'call:missed'
  | 'call:cancelled';
