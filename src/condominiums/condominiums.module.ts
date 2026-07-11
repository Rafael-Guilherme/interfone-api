import { Module } from '@nestjs/common';
import { CondominiumsController } from './condominiums.controller';
import { CondominiumsService } from './condominiums.service';
import { ManagerAccess } from './manager-access.service';

@Module({
  controllers: [CondominiumsController],
  providers: [CondominiumsService, ManagerAccess],
  exports: [ManagerAccess], // reusado por announcements / common-areas
})
export class CondominiumsModule {}
