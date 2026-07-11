import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommonAreaDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateCommonAreaDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
