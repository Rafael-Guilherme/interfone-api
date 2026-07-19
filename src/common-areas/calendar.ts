import { PrismaService } from '../prisma/prisma.service';

/**
 * Calendário de ocupação de uma área comum.
 *
 * Regra do produto: a reserva é sempre pelo DIA INTEIRO — só a data importa.
 * Guardamos isso em `starts_at`/`ends_at` como o intervalo [00:00, 24:00) do
 * dia, em UTC, para o dia não escorregar conforme o fuso de quem consulta.
 *
 * Cores do calendário (wireframe do gestor):
 *   livre        — disponível
 *   bloqueado    — cinza: AreaBlock, a administração fechou o dia
 *   ocupado      — vermelho: reservado por outro morador
 *   meu          — verde: reservado por quem está olhando
 *   administracao— azul: reservado por um perfil de gestor (evento do condomínio)
 *   fora_janela  — cinza: passado, ou além do limite de antecedência da área
 */
export type DayStatus =
  | 'livre'
  | 'bloqueado'
  | 'ocupado'
  | 'meu'
  | 'pendente' // reserva de morador aguardando aprovação (segura o dia)
  | 'administracao'
  | 'fora_janela';

export interface DiaCalendario {
  day: string; // YYYY-MM-DD
  status: DayStatus;
  reason?: string | null;
}

/** Meia-noite UTC do dia de uma data — a chave canônica de "dia". */
export function inicioDoDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** "YYYY-MM-DD" → meia-noite UTC. Rejeita formato inválido. */
export function diaParaData(dia: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error('Data inválida.');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) throw new Error('Data inválida.');
  return d;
}

export const dataParaDia = (d: Date): string => d.toISOString().slice(0, 10);

/** Intervalo [00:00, 24:00) do dia — é assim que a reserva é gravada. */
export function intervaloDoDia(dia: Date): { starts: Date; ends: Date } {
  const starts = inicioDoDia(dia);
  const ends = new Date(starts.getTime() + 24 * 60 * 60 * 1000);
  return { starts, ends };
}

/** Hoje em UTC — o piso do que ainda pode ser reservado. */
export const hoje = (): Date => inicioDoDia(new Date());

/**
 * Último dia reservável da área. `max_days_ahead = 30` significa hoje + 30.
 * null = sem limite.
 */
export function ultimoDiaReservavel(maxDaysAhead: number | null): Date | null {
  if (maxDaysAhead == null) return null;
  return new Date(hoje().getTime() + maxDaysAhead * 24 * 60 * 60 * 1000);
}

/** Papéis que pintam a reserva de azul (ocupado pela administração). */
const PAPEIS_GESTAO = ['manager', 'sub_manager'];

/**
 * Monta o calendário de `dias` dias a partir de hoje.
 *
 * `profileId` é o perfil de quem está olhando: as reservas dele saem como
 * 'meu' (verde). O gestor que consulta vê as próprias reservas como 'meu' —
 * é o comportamento esperado, já que o verde é "ocupado por você".
 */
export async function montarCalendario(
  prisma: PrismaService,
  areaId: string,
  opts: { dias: number; profileId?: string; maxDaysAhead: number | null },
): Promise<DiaCalendario[]> {
  const inicio = hoje();
  const fim = new Date(inicio.getTime() + opts.dias * 24 * 60 * 60 * 1000);
  const limite = ultimoDiaReservavel(opts.maxDaysAhead);

  const [reservas, bloqueios] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        common_area_id: areaId,
        // Pendente também segura o dia (ninguém mais reserva enquanto aguarda).
        status: { in: ['confirmed', 'pending'] },
        starts_at: { gte: inicio, lt: fim },
      },
      select: { starts_at: true, profile_id: true, status: true, profile: { select: { role: true } } },
    }),
    prisma.areaBlock.findMany({
      where: { common_area_id: areaId, day: { gte: inicio, lt: fim } },
      select: { day: true, reason: true },
    }),
  ]);

  const porDiaReserva = new Map(reservas.map((r) => [dataParaDia(r.starts_at), r]));
  const porDiaBloqueio = new Map(bloqueios.map((b) => [dataParaDia(b.day), b]));

  const saida: DiaCalendario[] = [];
  for (let i = 0; i < opts.dias; i++) {
    const dia = new Date(inicio.getTime() + i * 24 * 60 * 60 * 1000);
    const chave = dataParaDia(dia);

    const bloqueio = porDiaBloqueio.get(chave);
    if (bloqueio) {
      saida.push({ day: chave, status: 'bloqueado', reason: bloqueio.reason });
      continue;
    }

    const reserva = porDiaReserva.get(chave);
    if (reserva) {
      // Pendente é amarelo para todos (inclusive o dono) — sinaliza "aguardando".
      // A distinção "é minha" aparece na lista "Minhas reservas".
      const status: DayStatus =
        reserva.status === 'pending'
          ? 'pendente'
          : opts.profileId && reserva.profile_id === opts.profileId
            ? 'meu'
            : PAPEIS_GESTAO.includes(reserva.profile.role)
              ? 'administracao'
              : 'ocupado';
      saida.push({ day: chave, status });
      continue;
    }

    // Fora da janela vem por último: um dia ocupado continua mostrando por quem,
    // mesmo que já esteja além do limite de antecedência.
    if (limite && dia > limite) {
      saida.push({ day: chave, status: 'fora_janela' });
      continue;
    }

    saida.push({ day: chave, status: 'livre' });
  }
  return saida;
}
