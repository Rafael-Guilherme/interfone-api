import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra (ou reaponta) o aparelho do usuário logado.
   *
   * A chave é o `push_token`, não o par usuário+aparelho: o mesmo celular pode
   * trocar de dono ou receber o login de outro morador, e nesse caso o token
   * precisa *migrar* — se ficasse no usuário antigo, ele continuaria recebendo
   * as chamadas de quem usa o aparelho agora. Por isso o upsert atualiza o
   * `user_id` em vez de criar uma segunda linha (o token é único no schema).
   */
  async register(userId: string, dto: RegisterDeviceDto) {
    const device = await this.prisma.deviceToken.upsert({
      where: { push_token: dto.push_token },
      create: {
        user_id: userId,
        push_token: dto.push_token,
        platform: dto.platform,
        voip_token: dto.voip_token ?? null,
      },
      update: {
        user_id: userId,
        platform: dto.platform,
        // Só sobrescreve o token de VoIP quando veio um novo: um registro
        // parcial não pode apagar o que já estava lá.
        ...(dto.voip_token ? { voip_token: dto.voip_token } : {}),
        last_seen_at: new Date(),
      },
      select: { id: true, platform: true, created_at: true },
    });
    this.logger.log(`device ${dto.platform} registrado para ${userId}`);
    return { ok: true, device };
  }

  /**
   * Remove o aparelho — chamado no logout. Sem isso, o telefone continuaria
   * tocando as chamadas de quem saiu do app.
   *
   * Filtra por usuário também: o token vem do cliente e, sem esse escopo,
   * qualquer um autenticado poderia desregistrar o aparelho de outra pessoa.
   */
  async unregister(userId: string, pushToken: string) {
    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { user_id: userId, push_token: pushToken },
    });
    return { ok: true, removed: count };
  }
}
