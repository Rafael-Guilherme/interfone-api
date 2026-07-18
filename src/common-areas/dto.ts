import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateCommonAreaDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsInt() @Min(0) fee_cents?: number;
}

export class UpdateCommonAreaDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(0) fee_cents?: number | null;
}
