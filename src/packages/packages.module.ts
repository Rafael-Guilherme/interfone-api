import { Module } from '@nestjs/common';
import { PackagesController, ResidentPackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { CondominiumsModule } from '../condominiums/condominiums.module';
import { ResidentModule } from '../resident/resident.module';

/** Encomendas atendem os dois lados, então importa os dois guards de acesso. */
@Module({
  imports: [CondominiumsModule, ResidentModule],
  controllers: [PackagesController, ResidentPackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
