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
    };
  }
}
