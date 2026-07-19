import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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
