/** Uma notificação a enviar. `to` é o token do device (formato ExponentPushToken[…]). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Payload lido pelo app (tipo do evento, callId, sala…). Nunca exibido. */
  data?: Record<string, unknown>;
  /**
   * Canal Android. Chamada usa `calls` (importância MAX, toca e aparece na tela
   * de bloqueio); o resto usa `default`. O canal é criado no app, aqui só o
   * referenciamos pelo id.
   */
  channelId?: 'calls' | 'default';
  /**
   * Alta prioridade acorda o aparelho em Doze/economia de bateria. Obrigatório
   * para chamada — na prioridade normal o Android pode segurar a mensagem por
   * minutos, e a chamada já terá expirado.
   */
  priority?: 'default' | 'normal' | 'high';
  /** Segundos que o push continua válido na fila do provedor. */
  ttlSeconds?: number;
  /** Silencioso (sem alerta visível) — usado para cancelar um toque em curso. */
  silent?: boolean;
}

export interface PushGateway {
  /** Envia o lote. Não lança: falha de push nunca derruba o fluxo que a originou. */
  send(messages: PushMessage[]): Promise<void>;
}
