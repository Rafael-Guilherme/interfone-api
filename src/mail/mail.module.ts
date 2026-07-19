import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Global: auth e, futuramente, avisos/encomendas também mandam e-mail. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
