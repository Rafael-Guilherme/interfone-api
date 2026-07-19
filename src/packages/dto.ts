import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePackageDto {
  @IsUUID()
  unit_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  /** Nome do destinatário — a unidade pode ter mais de um morador. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  carrier?: string;
}

export class PickupDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nota?: string;
}

export class ListPackagesQuery {
  @IsOptional()
  @IsIn(['waiting', 'picked_up'])
  status?: 'waiting' | 'picked_up';
}
