import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateQrDto {
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsString() unit_id?: string; // QR de unidade específica (opcional)
}

export class UpdateQrDto {
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
