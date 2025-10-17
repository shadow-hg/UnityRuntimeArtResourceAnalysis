type TelemetryWSOptions = {
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
};

export class TelemetryWS {
  ws: WebSocket | null = null;
  url: string;
  onMessage: ((m: any) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: ((event: CloseEvent) => void) | null = null;
  onError: ((event: Event) => void) | null = null;
  autoReconnect: boolean;
  reconnectDelay: number;
  maxReconnectDelay: number;
  private manualClose = false;
  private initialDelay: number;

  constructor(url: string, options: TelemetryWSOptions = {}) {
    this.url = url;
    this.autoReconnect = options.autoReconnect ?? false;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.initialDelay = this.reconnectDelay;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 8000;
  }

  private cleanupSocket() {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws = null;
  }

  private scheduleReconnect() {
    if (!this.autoReconnect || this.manualClose) return;
    const delay = this.reconnectDelay;
    setTimeout(() => {
      if (this.manualClose) return;
      this.connect();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualClose = false;
    this.cleanupSocket();
    const socket = new WebSocket(this.url);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectDelay = this.initialDelay;
      try {
        this.send({ role: 'browser' });
      } catch (error) {
        console.warn('ws send failed on open', error);
      }
      if (this.onOpen) this.onOpen();
    };

    socket.onmessage = (ev) => {
      try {
        const payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (this.onMessage) this.onMessage(payload);
      } catch (error) {
        console.warn('invalid json', error);
      }
    };

    socket.onclose = (event) => {
      if (this.onClose) this.onClose(event);
      this.cleanupSocket();
      this.scheduleReconnect();
    };

    socket.onerror = (event) => {
      if (this.onError) this.onError(event);
    };
  }

  send(obj: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.manualClose = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.warn('ws close failed', error);
      }
    }
    this.cleanupSocket();
  }
}

export default TelemetryWS;
