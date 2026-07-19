import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto, UpdateMeDto, VerifyOtpDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Passo 1: pede o código por e-mail.
   * Limite apertado: cada chamada dispara um e-mail (custo real) e pode ser
   * usada para bombardear a caixa de entrada de terceiros.
   */
  @Throttle({ curto: { ttl: 60_000, limit: 3 }, longo: { ttl: 3_600_000, limit: 10 } })
  @Post('auth/request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.email, dto.name);
  }

  /**
   * Passo 2: confirma o código → access token + perfis.
   * Segunda barreira contra adivinhação, além do limite de tentativas por
   * código: aqui o teto é por IP, lá é por código.
   */
  @Throttle({ curto: { ttl: 60_000, limit: 10 }, longo: { ttl: 3_600_000, limit: 40 } })
  @Post('auth/verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.email, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUserId() userId: string) {
    return this.auth.me(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@CurrentUserId() userId: string, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(userId, dto);
  }
}
