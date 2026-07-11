import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { SignalingGateway } from './signaling.gateway';
import { LiveKitService } from './livekit.service';
import { CallPushService } from './call-push.service';
import {
  MessagesController,
  MessagesService,
} from './messages.controller';

/**
 * Chamadas internas + signaling + recados.
 *
 * LiveKitService e CallPushService são adaptadores de integração — normalmente
 * viriam de um IntegrationsModule compartilhado; declarados aqui no esqueleto
 * para manter o módulo autocontido. Ambos são mockáveis em teste.
 *
 * O SignalingGateway é injetável e pode ser consumido pelo CallsService para
 * espelhar transições em tempo real (não acoplado no esqueleto para evitar
 * dependência circular; conectar via evento/EventEmitter na implementação).
 */
@Module({
  controllers: [CallsController, MessagesController],
  providers: [
    CallsService,
    MessagesService,
    SignalingGateway,
    LiveKitService,
    CallPushService,
  ],
  exports: [CallsService],
})
export class CallsModule {}
