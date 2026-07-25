import { Injectable, Logger } from '@nestjs/common';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { PushGateway, PushMessage } from '../types';

/**
 * Envio via serviço de push da Expo (que fala FCM no Android e APNs no iOS).
 *
 * A Expo entra como intermediária de propósito: um único token por aparelho
 * (`ExponentPushToken[…]`) cobre as duas lojas, sem carregar credencial de
 * serviço do Firebase nem chave .p8 da Apple dentro da API. Trocar por FCM/APNs
 * direto depois é escrever outro gateway com esta mesma interface — nada fora
 * de `push/` conhece a Expo.
 *
 * Limite conhecido: isto é push de *notificação*, não VoIP/PushKit. No Android
 * um push de alta prioridade no canal `calls` acorda o app e toca; no iOS com o
 * app encerrado o usuário vê uma notificação, não a tela de chamada nativa —
 * para isso é preciso PushKit + CallKit (campo `voip_token` já reservado no
 * schema).
 *
 * Sem `EXPO_ACCESS_TOKEN` o envio continua funcionando (a Expo não exige o
 * token), mas ele é recomendado em produção: sem ele qualquer um que descubra
 * um token de device pode mandar push em nome do projeto.
 */
@Injectable()
export class ExpoGateway implements PushGateway {
  private readonly logger = new Logger(ExpoGateway.name);
  private readonly expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });

  constructor(private readonly prisma: PrismaService) {}

  async send(messages: PushMessage[]): Promise<void> {
    if (messages.length === 0) return;

    // Token malformado é erro de cadastro, não de entrega: descartamos aqui
    // para não gastar uma requisição e não poluir os tickets.
    const validos = messages.filter((m) => {
      const prefixo = m.to.slice(0, 12); // antes do type guard, que estreita `to`
      if (Expo.isExpoPushToken(m.to)) return true;
      this.logger.warn(`token de push inválido descartado: ${prefixo}…`);
      return false;
    });
    if (validos.length === 0) return;

    const chunks = this.expo.chunkPushNotifications(validos.map((m) => this.traduzir(m)));
    const tickets: ExpoPushTicket[] = [];
    const inicio = Date.now();

    for (const chunk of chunks) {
      try {
        tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)));
      } catch (e) {
        // Falha de rede/serviço da Expo. Não relançamos: quem chamou está no
        // meio de uma chamada ou de um aviso, e o socket segue como canal
        // principal.
        this.logger.error(`lote de push falhou: ${(e as Error).message}`);
      }
    }

    const recibos: string[] = [];
    let erros = 0;
    for (const ticket of tickets) {
      if (ticket.status === 'ok') recibos.push(ticket.id);
      else {
        erros++;
        this.logger.warn(`push recusado na entrada: ${ticket.message}`);
        // A Expo já avisa aqui quando o aparelho desinstalou o app.
        if (ticket.details?.error === 'DeviceNotRegistered' && ticket.details?.expoPushToken) {
          await this.descartarToken(ticket.details.expoPushToken);
        }
      }
    }

    this.logger.debug(
      `push: ${validos.length} enviados, ${recibos.length} aceitos, ${erros} recusados (${Date.now() - inicio}ms)`,
    );

    if (recibos.length > 0) this.agendarConferenciaDeRecibos(recibos);
  }

  private traduzir(m: PushMessage): ExpoPushMessage {
    return {
      to: m.to,
      // Push silencioso não leva título/corpo: serve só para carregar o `data`
      // (ex.: "a chamada foi cancelada") sem alertar de novo o usuário.
      ...(m.silent ? {} : { title: m.title, body: m.body, sound: 'default' as const }),
      data: m.data,
      channelId: m.channelId ?? 'default',
      priority: m.priority ?? 'default',
      ttl: m.ttlSeconds,
      // Acorda o app no iOS para processar o `data` em background.
      _contentAvailable: m.silent || undefined,
    };
  }

  /**
   * O ticket só diz que a Expo aceitou a mensagem; quem confirma a entrega é o
   * recibo, e ele leva alguns minutos para existir. Conferimos depois, fora do
   * caminho da chamada, apenas para limpar tokens de aparelhos que
   * desinstalaram o app — senão a tabela `DeviceToken` acumula tokens mortos e
   * todo envio passa a gastar requisição à toa.
   */
  private agendarConferenciaDeRecibos(ids: string[]) {
    const t = setTimeout(() => void this.conferirRecibos(ids), 60_000);
    t.unref?.(); // não segura o processo no shutdown
  }

  private async conferirRecibos(ids: string[]) {
    for (const chunk of this.expo.chunkPushNotificationReceiptIds(ids)) {
      try {
        const recibos = await this.expo.getPushNotificationReceiptsAsync(chunk);
        for (const [id, recibo] of Object.entries(recibos)) {
          if (recibo.status !== 'error') continue;
          this.logger.warn(`push não entregue (${id}): ${recibo.message}`);
          if (recibo.details?.error === 'DeviceNotRegistered') {
            const token = (recibo.details as { expoPushToken?: string }).expoPushToken;
            if (token) await this.descartarToken(token);
          }
        }
      } catch (e) {
        this.logger.error(`falha ao conferir recibos: ${(e as Error).message}`);
      }
    }
  }

  private async descartarToken(pushToken: string) {
    await this.prisma.deviceToken
      .deleteMany({ where: { push_token: pushToken } })
      .then((r) => {
        // A Expo devolve DeviceNotRegistered tanto para app desinstalado quanto
        // para token que ela não reconhece — nos dois casos a linha não serve.
        if (r.count > 0) this.logger.log(`device removido (token não entregável): ${pushToken.slice(0, 20)}…`);
      })
      .catch((e) => this.logger.error(`falha ao remover device: ${(e as Error).message}`));
  }
}
