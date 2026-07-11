import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { QrValidationService } from './qr-validation.service';
import { CallsModule } from '../calls/calls.module';

/**
 * Web do entregador (pública).
 *
 * Importa CallsModule para reusar CallsService.startDelivery — a criação da
 * chamada, o token de mídia e o push vivem no domínio de calls; delivery só
 * orquestra o fluxo anônimo e aplica o recorte LGPD nas respostas.
 *
 * QrValidationService é declarado aqui, mas na árvore final pertence ao módulo
 * qrcodes e seria importado dele (validação de QR é compartilhada).
 */
@Module({
  imports: [CallsModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, QrValidationService],
})
export class DeliveryModule {}
