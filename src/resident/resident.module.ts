import { Module } from '@nestjs/common';
import { ResidentController } from './resident.controller';
import { ResidentService } from './resident.service';
import { ResidentAccess } from './resident-access.service';

@Module({
  controllers: [ResidentController],
  providers: [ResidentService, ResidentAccess],
  exports: [ResidentAccess], // reusado por packages (lado do morador)
})
export class ResidentModule {}
