import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  common_area_id!: string;

  @IsDateString()
  starts_at!: string;

  @IsDateString()
  ends_at!: string;
}

export class CreateResidentQrDto {
  @IsString()
  @IsNotEmpty()
  label!: string; // destinatário (ex.: nome do visitante)

  @IsOptional()
  @IsIn(['today', 'period', 'fixed'])
  validity_mode?: 'today' | 'period' | 'fixed';

  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @IsOptional()
  @IsIn(['single', 'unlimited'])
  usage_mode?: 'single' | 'unlimited';
}
