import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Push de chamada. iOS exige PushKit/VoIP (token separado) para tocar a chamada
 * com o app encerrado e integrar com CallKit; Android usa FCM data-message de
 * alta prioridade consumido pelo CallKeep.
 *
 * Aqui só a fronteira: a integração real com firebase-admin / node-apn fica
 * atrás desta interface para poder ser mockada.
 */
@Injectable()
export class CallPushService {
  private readonly logger = new Logger(CallPushService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Notifica todos os devices dos profiles-alvo que há uma chamada tocando. */
  async ringDevices(params: {
    callId: string;
    targetUserIds: string[];
    callerName: string;
    media: 'audio' | 'video';
    room: string;
  }): Promise<void> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { user_id: { in: params.targetUserIds } },
      select: { platform: true, push_token: true, voip_token: true },
    });

    const payload = {
      type: 'incoming_call',
      callId: params.callId,
      caller: params.callerName,
      media: params.media,
      room: params.room,
    };

    for (const d of devices) {
      if (d.platform === 'ios' && d.voip_token) {
        await this.sendApnsVoip(d.voip_token, payload);
      } else {
        await this.sendFcmData(d.push_token, payload);
      }
    }
  }

  /** Cancela o toque (chamada atendida em outro device, recusada ou expirada). */
  async cancelRing(params: {
    callId: string;
    targetUserIds: string[];
  }): Promise<void> {
    // Envia um data-message "call_cancelled" para os devices pararem de tocar.
    this.logger.debug(
      `cancelRing call=${params.callId} targets=${params.targetUserIds.length}`,
    );
    // ... firebase-admin / node-apn ...
  }

  private async sendApnsVoip(_voipToken: string, _payload: unknown) {
    // node-apn: notification.pushType = 'voip'
    // implementação real fora do esqueleto
  }

  private async sendFcmData(_pushToken: string, _payload: unknown) {
    // firebase-admin: messaging().send({ token, data, android: { priority: 'high' } })
    // implementação real fora do esqueleto
  }
}
