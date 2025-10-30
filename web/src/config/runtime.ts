export type DeploymentMode = 'production' | 'local-test';

export const DEFAULT_SERVER_PORT = 48080;
export const DEFAULT_SERVER_IP = '0.0.0.0';
const LOCAL_TEST_SERVER_IP = '127.0.0.1';

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function resolveRuntimeMode(): DeploymentMode {
  if (import.meta.env.PROD) {
    return 'production';
  }
  const explicit = (import.meta.env.VITE_APP_RUNTIME_MODE ?? '').trim().toLowerCase();
  if (explicit === 'production') {
    return 'production';
  }
  if (explicit === 'local-test') {
    return 'local-test';
  }
  if (import.meta.env.DEV) {
    return 'local-test';
  }
  return 'production';
}

export const RUNTIME_MODE: DeploymentMode = resolveRuntimeMode();

export interface RuntimeDefaults {
  readonly mode: DeploymentMode;
  readonly serverIp: string;
  readonly serverPort: string;
  readonly serverBaseUrl: string;
  readonly autoConnect: boolean;
}

export const RUNTIME_DEFAULTS: RuntimeDefaults = (() => {
  if (RUNTIME_MODE === 'local-test' && !import.meta.env.PROD) {
    const localPort = parsePort(import.meta.env.VITE_LOCAL_TEST_SERVER_PORT, DEFAULT_SERVER_PORT);
    const baseUrl = `http://${LOCAL_TEST_SERVER_IP}:${localPort}`;
    return {
      mode: 'local-test',
      serverIp: LOCAL_TEST_SERVER_IP,
      serverPort: String(localPort),
      serverBaseUrl: baseUrl,
      autoConnect: true,
    } as const;
  }

  return {
    mode: 'production',
    serverIp: DEFAULT_SERVER_IP,
    serverPort: String(DEFAULT_SERVER_PORT),
    serverBaseUrl: '',
    autoConnect: false,
  } as const;
})();
