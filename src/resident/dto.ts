import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * Reserva é sempre pelo dia inteiro, então o cliente manda só a data.
 * `starts_at`/`ends_at` deixaram de existir aqui — o intervalo do dia é
 * derivado no servidor (ver common-areas/calendar.ts).
 */
export class CreateReservationDto {
  @IsUUID()
  common_area_id!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day deve estar no formato YYYY-MM-DD.' })
  day!: string;
}

class QueueEntry {
  @IsUUID()
  profile_id!: string;

  @IsBoolean()
  na_fila!: boolean;
}

/** A ordem do array É a ordem de toque. */
export class SetCallQueueDto {
  @IsUUID()
  unit_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QueueEntry)
  entradas!: QueueEntry[];
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
