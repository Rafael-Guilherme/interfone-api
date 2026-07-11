import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Contrato de ambiente. Validado no boot (ConfigModule.validate) — a app
 * recusa subir se faltar qualquer segredo obrigatório, em vez de falhar
 * mais tarde no primeiro request que precisar dele.
 */
class EnvVars {
  @IsOptional()
  @IsInt()
  PORT?: number;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  // Auth
  @IsString() @MinLength(16)
  JWT_ACCESS_SECRET!: string;

  @IsString() @MinLength(16)
  JWT_REFRESH_SECRET!: string;

  // Google (só app)
  @IsString() GOOGLE_CLIENT_ID_IOS!: string;
  @IsString() GOOGLE_CLIENT_ID_ANDROID!: string;

  // E-mail (OTP)
  @IsString() MAIL_API_KEY!: string;
  @IsString() MAIL_FROM!: string;

  // LiveKit
  @IsString() LIVEKIT_API_KEY!: string;
  @IsString() LIVEKIT_API_SECRET!: string;
  @IsUrl({ require_tld: false, protocols: ['ws', 'wss'] })
  LIVEKIT_URL!: string;

  // Push
  @IsString() FCM_PROJECT_ID!: string;
  @IsString() FCM_CLIENT_EMAIL!: string;
  @IsString() FCM_PRIVATE_KEY!: string;
  @IsOptional() @IsString() APNS_KEY_ID?: string;
  @IsOptional() @IsString() APNS_TEAM_ID?: string;

  // Storage
  @IsString() S3_BUCKET!: string;
  @IsString() S3_REGION!: string;

  @IsOptional() @IsString()
  CORS_ORIGINS?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Variáveis de ambiente inválidas:\n  - ${details}`);
  }
  return validated;
}
