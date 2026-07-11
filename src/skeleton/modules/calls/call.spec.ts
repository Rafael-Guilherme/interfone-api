/**
 * Testa a máquina de estados da store de chamada — o ciclo completo e as
 * transições inválidas (no-op) que protegem contra eventos duplicados de
 * push + socket.
 *
 * A store é Zustand puro (sem React), então testável direto via getState().
 */
import { useCall } from './call';

const reset = () => useCall.getState().reset();

const incoming = {
  callId: 'c1',
  callerName: 'Portaria',
  media: 'video' as const,
  room: 'call:c1',
};

describe('store de chamada — ciclo de vida', () => {
  beforeEach(reset);

  it('ciclo feliz: incoming → accept → connected → end → reset', () => {
    const s = () => useCall.getState();

    s().receiveIncoming(incoming);
    expect(s().phase).toBe('ringing');
    expect(s().videoEnabled).toBe(true); // media=video

    s().accept();
    expect(s().phase).toBe('connecting');

    s().connected({ token: 't', url: 'wss://lk' });
    expect(s().phase).toBe('inCall');
    expect(s().grant?.token).toBe('t');

    s().end();
    expect(s().phase).toBe('ended');

    s().reset();
    expect(s().phase).toBe('idle');
  });

  it('decline volta a idle', () => {
    const s = () => useCall.getState();
    s().receiveIncoming(incoming);
    s().decline();
    expect(s().phase).toBe('idle');
    expect(s().incoming).toBeNull();
  });

  it('incoming duplicado é no-op (não atropela chamada ativa)', () => {
    const s = () => useCall.getState();
    s().receiveIncoming(incoming);
    s().accept(); // connecting
    s().receiveIncoming({ ...incoming, callId: 'c2' }); // deve ser ignorado
    expect(s().phase).toBe('connecting');
    expect(s().incoming?.callId).toBe('c1');
  });

  it('connected só vale a partir de connecting', () => {
    const s = () => useCall.getState();
    s().receiveIncoming(incoming); // ringing
    s().connected({ token: 't', url: 'u' }); // inválido em ringing
    expect(s().phase).toBe('ringing');
  });

  it('accept só vale a partir de ringing', () => {
    const s = () => useCall.getState();
    s().accept(); // em idle
    expect(s().phase).toBe('idle');
  });

  it('toggles de mute/vídeo', () => {
    const s = () => useCall.getState();
    s().receiveIncoming(incoming);
    expect(s().muted).toBe(false);
    s().toggleMute();
    expect(s().muted).toBe(true);
    s().toggleVideo();
    expect(s().videoEnabled).toBe(false);
  });
});
