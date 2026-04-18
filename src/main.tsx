import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import { Toaster } from './Toaster';

const appId = import.meta.env.VITE_PRIVY_APP_ID;

if (!appId) {
  throw new Error(
    'VITE_PRIVY_APP_ID is required. Set it in .env.local for local dev, and in GitHub Actions secrets for CI builds.',
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
