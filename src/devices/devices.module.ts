import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, JwtAuthGuard],
})
export class DevicesModule {}
