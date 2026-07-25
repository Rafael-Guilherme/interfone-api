import { Global, Module } from '@nestjs/common';
import { PushService } from './push.service';
import { ExpoGateway } from './gateways/expo.gateway';

/** Global pelo mesmo motivo do MailModule: chamadas, avisos e encomendas usam. */
@Global()
@Module({
  providers: [PushService, ExpoGateway],
  exports: [PushService],
})
export class PushModule {}
