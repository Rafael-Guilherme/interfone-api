import { Module } from '@nestjs/common';
import { CondominiumsModule } from '../condominiums/condominiums.module';
import { QrCodesController } from './qrcodes.controller';
import { QrCodesService } from './qrcodes.service';

@Module({
  imports: [CondominiumsModule], // ManagerAccess
  controllers: [QrCodesController],
  providers: [QrCodesService],
})
export class QrCodesModule {}
