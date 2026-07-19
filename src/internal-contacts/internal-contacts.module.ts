import { Module } from '@nestjs/common';
import { CondominiumsModule } from '../condominiums/condominiums.module';
import { InternalContactsController } from './internal-contacts.controller';
import { InternalContactsService } from './internal-contacts.service';

@Module({
  imports: [CondominiumsModule], // ManagerAccess
  controllers: [InternalContactsController],
  providers: [InternalContactsService],
})
export class InternalContactsModule {}
