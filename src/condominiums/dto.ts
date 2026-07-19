import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// ---- blocos de entrada reutilizados (declarados antes de quem os referencia:
// com emitDecoratorMetadata, o tipo é avaliado na definição da classe) ----

export class UnitInput {
  @IsString()
  @IsNotEmpty()
  number!: string;
}

export class BlockInput {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitInput)
  units!: UnitInput[];
}

export class GeoInput {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsInt()
  @Min(10)
  radius_m!: number;
}

/**
 * Cadastro de interfone (síndico). Se `has_blocks` for false (interfone de 1
 * residência ou prédio sem blocos), envie `units`; caso contrário, `blocks`
 * (cada um com suas unidades).
 */
export class CreateCondominiumDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  photo_url?: string; // data URI (MVP) ou URL

  @IsOptional() @IsString() zip_code?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() street_number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;

  @IsBoolean()
  has_blocks!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlockInput)
  blocks?: BlockInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitInput)
  units?: UnitInput[];

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoInput)
  geo?: GeoInput;
}

export class UpdateCondominiumDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() photo_url?: string;
  @IsOptional() @IsString() zip_code?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() street_number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoInput)
  geo?: GeoInput;
}

export class ManagerPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class ManagerActionDto {
  @IsIn(['approve', 'reject', 'remove'])
  action!: 'approve' | 'reject' | 'remove';
}

export class ResidentActionDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';
}

export class BlockDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UnitDto {
  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsOptional()
  @IsString()
  block_id?: string;
}

export class JoinDto {
  @IsOptional()
  @IsString()
  unit_id?: string; // obrigatório para morador; ignorado para síndico

  @IsOptional()
  @IsIn(['resident', 'manager'])
  as?: 'resident' | 'manager';
}
