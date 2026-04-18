import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import { Toaster } from './Toaster';
import { initRemoteLog } from './remoteLog';

initRemoteLog(import.meta.env.VITE_LOG_ENDPOINT);

const FALLBACK_APP_ID = 'cmbir1ip600bejx0mu6b42iek';

const appId = import.meta.env.VITE_PRIVY_APP_ID || FALLBACK_APP_ID;

if (!appId) {
  throw new Error(
    'VITE_PRIVY_APP_ID is required. Set it in .env.local for local dev, and in GitHub Actions vars or secrets for CI builds.',
  );
}

if (!import.meta.env.VITE_PRIVY_APP_ID) {
  console.warn(
    '[privy-tg-test] VITE_PRIVY_APP_ID env not set; using hardcoded FALLBACK_APP_ID. OK for this demo (App ID is public), but fix the build env for other apps.',
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['telegram'],
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
        appearance: { theme: 'light' },
      }}
    >
      <App />
      <Toaster />
    </PrivyProvider>
  </StrictMode>,
);
