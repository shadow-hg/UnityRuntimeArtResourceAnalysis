export class TelemetryWS {
  ws: WebSocket | null = null;
  url: string;
  onMessage: ((m: any) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: ((event: CloseEvent) => void) | null = null;
  onError: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      console.log('ws open');
      this.send({ role: 'browser' });
      if (this.onOpen) this.onOpen();
    };
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (this.onMessage) this.onMessage(data);
      } catch (e) {
        console.warn('invalid json', e);
      }
    };
    this.ws.onclose = (event) => {
      console.log('ws closed');
      if (this.onClose) this.onClose(event);
    };
    this.ws.onerror = (event) => {
      console.warn('ws error', event);
      if (this.onError) this.onError(event);
    };
  }

  send(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() { if (this.ws) this.ws.close(); this.ws = null; }
}

export default TelemetryWS;