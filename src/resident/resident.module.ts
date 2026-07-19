import { Module } from '@nestjs/common';
import { ResidentController } from './resident.controller';
import { ResidentService } from './resident.service';
import { ResidentAccess } from './resident-access.service';

@Module({
  controllers: [ResidentController],
  providers: [ResidentService, ResidentAccess],
})
export class ResidentModule {}
