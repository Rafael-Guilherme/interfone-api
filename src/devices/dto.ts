import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  /** Token do aparelho (`ExponentPushToken[…]`). */
  @IsString()
  @MaxLength(255)
  push_token!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';

  /** Token do PushKit (iOS). Reservado para quando o CallKit entrar. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  voip_token?: string;
}
