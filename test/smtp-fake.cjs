/**
 * Servidor SMTP mínimo para teste local: aceita a conversa até o DATA e imprime
 * a mensagem recebida. Serve para provar que o MailService realmente fala SMTP,
 * sem depender de provedor externo nem mandar e-mail de verdade.
 *
 *   node test/smtp-fake.cjs [porta]
 */
const net = require('node:net');

const PORTA = Number(process.argv[2] ?? 2525);

const servidor = net.createServer((sock) => {
  let emDados = false;
  let mensagem = '';

  const responder = (linha) => sock.write(linha + '\r\n');
  responder('220 smtp-fake pronto');

  sock.on('data', (buf) => {
    const texto = buf.toString();

    if (emDados) {
      mensagem += texto;
      // Fim do DATA é uma linha só com ponto.
      if (mensagem.includes('\r\n.\r\n')) {
        emDados = false;
        const corpo = mensagem.split('\r\n.\r\n')[0];
        console.log('=== MENSAGEM RECEBIDA ===');
        console.log(corpo);
        console.log('=== FIM ===');
        responder('250 OK: mensagem aceita');
      }
      return;
    }

    for (const linha of texto.split('\r\n').filter(Boolean)) {
      const cmd = linha.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') {
        responder('250-smtp-fake');
        responder('250-AUTH PLAIN LOGIN');
        responder('250 SIZE 10485760');
      } else if (cmd === 'AUTH') {
        // Aceita qualquer credencial: o alvo do teste é o envio, não o login.
        responder('235 2.7.0 autenticado');
      } else if (cmd === 'MAIL') {
        console.log('  >', linha);
        responder('250 OK');
      } else if (cmd === 'RCPT') {
        console.log('  >', linha);
        responder('250 OK');
      } else if (cmd === 'DATA') {
        emDados = true;
        mensagem = '';
        responder('354 pode mandar, termine com .');
      } else if (cmd === 'QUIT') {
        responder('221 tchau');
        sock.end();
      } else if (cmd === 'RSET' || cmd === 'NOOP') {
        responder('250 OK');
      } else {
        responder('250 OK');
      }
    }
  });

  sock.on('error', () => {});
});

servidor.listen(PORTA, '127.0.0.1', () => console.log(`smtp-fake escutando em :${PORTA}`));
