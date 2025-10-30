/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_RUNTIME_MODE?: 'production' | 'local-test' | string;
  readonly VITE_LOCAL_TEST_SERVER_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
