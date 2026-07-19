import { Module } from '@nestjs/common';
import { CondominiumsController } from './condominiums.controller';
import { CondominiumsService } from './condominiums.service';
import { ManagerAccess } from './manager-access.service';
import { ResidentsPdfService } from './residents-pdf.service';
import { ResidentsPdfController } from './residents-pdf.controller';

@Module({
  controllers: [CondominiumsController, ResidentsPdfController],
  providers: [CondominiumsService, ManagerAccess, ResidentsPdfService],
  exports: [ManagerAccess], // reusado por announcements / common-areas
})
export class CondominiumsModule {}
