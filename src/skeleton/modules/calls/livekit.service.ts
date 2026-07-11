import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

/**
 * Emissão de token de acesso ao LiveKit.
 *
 * Isolado em integrations/ para: (a) mockar em teste; (b) trocar
 * LiveKit Cloud → self-hosted sem tocar no domínio (só muda url/credenciais no env).
 *
 * A room de uma chamada é sempre `call:<callId>` — efêmera, criada on-demand
 * pelo LiveKit quando o primeiro participante entra.
 */
@Injectable()
export class LiveKitService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Gera um JWT assinado com a API key/secret do LiveKit.
   * @param room     nome da room (ex.: `call:<callId>`)
   * @param identity identidade do participante (ex.: `profile:<id>` ou `delivery:<token>`)
   * @param canPublishVideo se false, participante entra só com áudio (atender por voz)
   */
  async issueToken(params: {
    room: string;
    identity: string;
    name?: string;
    canPublishVideo: boolean;
    ttlSeconds?: number;
  }): Promise<{ token: string; url: string }> {
    const apiKey = this.config.getOrThrow<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.getOrThrow<string>('LIVEKIT_API_SECRET');
    const url = this.config.getOrThrow<string>('LIVEKIT_URL');

    const at = new AccessToken(apiKey, apiSecret, {
      identity: params.identity,
      name: params.name,
      ttl: params.ttlSeconds ?? 3600,
    });

    at.addGrant({
      room: params.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // controla se pode publicar vídeo; áudio sempre permitido
      canPublishSources: params.canPublishVideo
        ? undefined // todas as fontes
        : [TrackSource.MICROPHONE],
    });

    const token = await at.toJwt();
    return { token, url };
  }
}
