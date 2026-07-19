import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Posição do visitante, vinda do navegador na query de GET /q/:token. */
export class ResolveQuery {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng?: number;
}

/**
 * Recado deixado pelo entregador quando ninguém atende. Endpoint público
 * (a credencial é o token do QR), então os campos são limitados no tamanho
 * para não virar vetor de spam/armazenamento.
 */
export class LeaveMessageDto {
  @IsOptional()
  @IsUUID()
  unit_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  visitor_name?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
