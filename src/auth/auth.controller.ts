import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto, UpdateMeDto, VerifyOtpDto } from './dto';
import { CurrentUserId, JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Passo 1: pede o código por e-mail. */
  @Post('auth/request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.email, dto.name);
  }

  /** Passo 2: confirma o código → access token + perfis. */
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
