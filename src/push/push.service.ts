import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoGateway } from './gateways/expo.gateway';
import { PushGateway, PushMessage } from './types';

/**
 * Ponto único de push da API.
 *
 * O resto do sistema fala em *usuários* ("avise a Ana que está tocando"), não
 * em tokens de aparelho: é este serviço que resolve os devices de cada usuário
 * e delega ao gateway. Trocar de provedor (FCM/APNs direto, OneSignal) é
 * registrar outro gateway em `gateways` e mudar `PUSH_DRIVER`.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly gateway: PushGateway;

  constructor(
    private readonly prisma: PrismaService,
    private readonly expo: ExpoGateway,
  ) {
    const gateways: Record<string, PushGateway> = { expo: this.expo };
    const driver = process.env.PUSH_DRIVER ?? 'expo';
    this.gateway = gateways[driver] ?? this.expo;
    if (!gateways[driver]) {
      this.logger.warn(`PUSH_DRIVER="${driver}" desconhecido — usando "expo".`);
    }
  }

  /**
   * Chamada tocando no aparelho do morador da vez.
   *
   * `ttl` curto de propósito: se o push não chegou enquanto o telefone tocava,
   * entregá-lo depois só produz uma notificação fantasma de uma chamada que já
   * terminou. Vale um pouco mais que a etapa do transbordo, para cobrir atraso
   * de rede.
   */
  async notificarChamada(
    userId: string,
    payload: { callId: string; caller: string; media: 'audio' | 'video'; room: string },
    ttlSeconds: number,
  ) {
    await this.enviarParaUsuarios([userId], {
      title: 'Chamada no interfone',
      body: payload.caller,
      data: { type: 'incoming_call', ...payload },
      channelId: 'calls',
      priority: 'high',
      ttlSeconds,
    });
  }

  /**
   * Para o toque: o morador atendeu em outro aparelho, o transbordo passou
   * adiante ou o entregador desistiu. Silencioso — o app usa o `data` para
   * fechar a tela de chamada, sem alertar de novo.
   */
  async cancelarChamada(userIds: string[], callId: string) {
    await this.enviarParaUsuarios(userIds, {
      title: '',
      body: '',
      data: { type: 'call_cancelled', callId },
      channelId: 'calls',
      priority: 'high',
      ttlSeconds: 60,
      silent: true,
    });
  }

  /** Aviso do síndico, encomenda, etc. — notificação comum, sem urgência. */
  async notificar(userIds: string[], title: string, body: string, data?: Record<string, unknown>) {
    await this.enviarParaUsuarios(userIds, { title, body, data, channelId: 'default' });
  }

  /**
   * Resolve os aparelhos dos usuários e envia. Um usuário pode ter vários
   * devices (celular + tablet) e todos tocam; quem desempata é o servidor,
   * mandando o cancelamento para os demais assim que um atende.
   */
  private async enviarParaUsuarios(
    userIds: string[],
    msg: Omit<PushMessage, 'to'>,
  ): Promise<void> {
    if (userIds.length === 0) return;
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: { user_id: { in: userIds } },
        select: { push_token: true },
      });
      if (devices.length === 0) {
        this.logger.debug(`sem devices registrados para ${userIds.length} usuário(s) — só socket`);
        return;
      }
      await this.gateway.send(devices.map((d) => ({ ...msg, to: d.push_token })));
    } catch (e) {
      // Push é canal secundário: o socket já entregou o evento a quem está com
      // o app aberto. Falhar aqui não pode derrubar a chamada.
      this.logger.error(`falha ao enviar push: ${(e as Error).message}`);
    }
  }
}
