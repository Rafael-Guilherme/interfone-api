import { Injectable, Logger } from '@nestjs/common';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

/**
 * Emissão de token de acesso ao LiveKit (mídia A/V real).
 *
 * A sala de uma chamada é sempre `call:<callId>`. Se as credenciais LiveKit ainda
 * forem placeholders (.env.example), cai num GRANT stub (provider=demo) — a
 * sinalização funciona igual e a UI mostra "Em chamada" sem A/V. Basta preencher
 * LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET para ativar a mídia.
 */
export interface MediaGrant {
  provider: 'livekit' | 'demo';
  room: string;
  identity: string;
  token: string;
  url: string;
}

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);

  private get apiKey() {
    return process.env.LIVEKIT_API_KEY ?? '';
  }
  private get apiSecret() {
    return process.env.LIVEKIT_API_SECRET ?? '';
  }
  private get url() {
    return process.env.LIVEKIT_URL ?? '';
  }

  /** Só emite token real quando as 3 variáveis estão preenchidas de verdade. */
  isConfigured(): boolean {
    const placeholder =
      !this.url ||
      this.url.includes('seu-') ||
      this.apiKey.startsWith('APIxxx') ||
      this.apiSecret.startsWith('secretxxx') ||
      !this.apiKey ||
      !this.apiSecret;
    return !placeholder;
  }

  async issueGrant(params: {
    room: string;
    identity: string;
    name?: string;
    canPublishVideo: boolean;
    ttlSeconds?: number;
  }): Promise<MediaGrant> {
    if (!this.isConfigured()) {
      return {
        provider: 'demo',
        room: params.room,
        identity: params.identity,
        token: `demo-token:${params.room}:${params.identity}`,
        url: this.url || 'demo://livekit',
      };
    }

    const at = new AccessToken(this.apiKey, this.apiSecret, {
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
      // vídeo controlado; áudio sempre permitido
      canPublishSources: params.canPublishVideo ? undefined : [TrackSource.MICROPHONE],
    });

    return {
      provider: 'livekit',
      room: params.room,
      identity: params.identity,
      token: await at.toJwt(),
      url: this.url,
    };
  }
}
