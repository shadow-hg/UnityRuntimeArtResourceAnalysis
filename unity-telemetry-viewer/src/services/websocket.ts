export type WSMessage = any;

export class TelemetryWS {
  ws: WebSocket | null = null;
  url: string;
  onMessage: ((m: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      console.log('ws open');
      this.send({ role: 'browser' });
    };
    this.ws.onmessage = (ev) => {
      try { const data = JSON.parse(ev.data); if (this.onMessage) this.onMessage(data); } catch(e) { console.warn('invalid json', e); }
    };
    this.ws.onclose = () => console.log('ws closed');
    this.ws.onerror = (e) => console.warn('ws error', e);
  }

  send(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() { if (this.ws) this.ws.close(); this.ws = null; }
}

export default TelemetryWS;