import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() avatar_url?: string;
}

export class RequestOtpDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class RefreshDto {
  /** Token opaco emitido no login. Não é JWT: só vale se estiver no banco. */
  @IsString()
  @MaxLength(255)
  refresh!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  refresh?: string;
}

export class GoogleLoginDto {
  /** id_token (JWT do Google) obtido pelo sign-in nativo no app. */
  @IsString()
  @MaxLength(4096)
  id_token!: string;
}
