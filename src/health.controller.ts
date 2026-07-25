import { Controller, Get } from '@nestjs/common';
import { LiveKitService } from './livekit/livekit.service';

@Controller()
export class HealthController {
  constructor(private readonly livekit: LiveKitService) {}

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'interfone-api',
      db: 'postgres',
      livekit: this.livekit.isConfigured() ? 'configured' : 'stub (preencha LIVEKIT_* no .env)',
      // O push funciona sem EXPO_ACCESS_TOKEN, mas aí qualquer um que descubra
      // um token de aparelho pode mandar notificação em nome do projeto.
      push: process.env.EXPO_ACCESS_TOKEN ? 'expo (autenticado)' : 'expo (sem EXPO_ACCESS_TOKEN)',
    };
  }
}
