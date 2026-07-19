import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CondoActionDto {
  @IsIn(['approve', 'reject', 'suspend', 'reactivate'])
  action!: 'approve' | 'reject' | 'suspend' | 'reactivate';
}

export class UserActionDto {
  @IsIn(['block', 'unblock', 'grant_admin', 'revoke_admin'])
  action!: 'block' | 'unblock' | 'grant_admin' | 'revoke_admin';
}

export class ListCondosQuery {
  @IsOptional()
  @IsIn(['pending', 'active', 'suspended', 'all'])
  filtro?: 'pending' | 'active' | 'suspended' | 'all';
}

export class ListUsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** Filtra por condomínio. */
  @IsOptional()
  @IsUUID()
  condo?: string;

  /** Filtra por papel dentro do condomínio. */
  @IsOptional()
  @IsIn(['resident', 'manager', 'sub_manager', 'delivery', 'merchant', 'service_provider', 'staff'])
  papel?: string;
}

/** Troca o papel de um perfil dentro do condomínio (ação do admin). */
export class SetProfileRoleDto {
  @IsIn(['resident', 'sub_manager', 'manager'])
  role!: 'resident' | 'sub_manager' | 'manager';
}
