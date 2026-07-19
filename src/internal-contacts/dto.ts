import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateContactDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) phone!: string;
  @IsOptional() @IsString() @MaxLength(120) note?: string;
  @IsOptional() @IsInt() @Min(0) display_order?: number;
}

export class UpdateContactDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) note?: string;
  @IsOptional() @IsInt() @Min(0) display_order?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
