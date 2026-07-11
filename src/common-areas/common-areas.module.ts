import { Module } from '@nestjs/common';
import { CondominiumsModule } from '../condominiums/condominiums.module';
import { CommonAreasController } from './common-areas.controller';
import { CommonAreasService } from './common-areas.service';

@Module({
  imports: [CondominiumsModule], // ManagerAccess
  controllers: [CommonAreasController],
  providers: [CommonAreasService],
})
export class CommonAreasModule {}
