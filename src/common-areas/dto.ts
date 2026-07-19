import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateCommonAreaDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsInt() @Min(0) fee_cents?: number;
  /** Janela de agendamento em dias. Teto de 365 para não virar "sem limite" por engano. */
  @IsOptional() @IsInt() @Min(1) @Max(365) max_days_ahead?: number;
}

export class UpdateCommonAreaDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(0) fee_cents?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(365) max_days_ahead?: number | null;
}

/** Marca (`blocked:true`) ou desmarca um dia indisponível da área. */
export class SetAreaBlockDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day deve estar no formato YYYY-MM-DD.' })
  day!: string;

  @IsBoolean()
  blocked!: boolean;

  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}

/** Reserva feita pela administração (evento do condomínio). */
export class ManagementReservationDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day deve estar no formato YYYY-MM-DD.' })
  day!: string;
}

/** Aprovar/recusar uma reserva pendente. */
export class DecideReservationDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';
}
