import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GoogleLoginDto, LogoutDto, RefreshDto, RequestOtpDto, UpdateMeDto, VerifyOtpDto } from './dto';
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

  /**
   * Login/registro com Google (só o app usa). O app manda o `id_token` do
   * sign-in nativo; o servidor verifica e devolve a mesma sessão do OTP.
   */
  @Throttle({ curto: { ttl: 60_000, limit: 10 }, longo: { ttl: 3_600_000, limit: 60 } })
  @Post('auth/google')
  google(@Body() dto: GoogleLoginDto) {
    return this.auth.loginWithGoogle(dto.id_token);
  }

  /**
   * Renova a sessão. É o que mantém o morador logado entre uma chamada e outra
   * sem pedir o código de novo — e o que expira a conta de quem sumiu por
   * REFRESH_TTL_DIAS.
   *
   * Limite mais folgado que o do OTP: aqui não há e-mail nem código a adivinhar
   * (o token tem 48 bytes aleatórios), e o app renova sozinho a cada abertura.
   */
  @Throttle({ curto: { ttl: 60_000, limit: 20 }, longo: { ttl: 3_600_000, limit: 120 } })
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh);
  }

  /** Encerra a sessão DESTE aparelho. Sem guard: um token já inválido também sai. */
  @Post('auth/logout')
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refresh);
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
