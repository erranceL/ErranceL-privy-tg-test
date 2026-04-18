/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_LOG_ENDPOINT?: string;
  readonly VITE_LOGIN_API_BASE?: string;
  readonly VITE_BIZ_PF?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            photo_url?: string;
          };
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
    };
  }
}

export {};
