import { Module } from '@nestjs/common';
import { CondominiumsModule } from '../condominiums/condominiums.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [CondominiumsModule], // ManagerAccess
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
