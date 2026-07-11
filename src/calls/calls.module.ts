import { Module } from '@nestjs/common';
import { CallsGateway } from './calls.gateway';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [DeliveryModule],
  providers: [CallsGateway],
})
export class CallsModule {}
