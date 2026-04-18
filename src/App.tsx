import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useLoginWithTelegram } from '@privy-io/react-auth';
import { emitToast } from './toast';

function normalizeError(err: unknown): { type: string; code: string; msg: string } {
  const type = typeof err;
  if (typeof err === 'string') return { type, code: 'n/a', msg: err };
  if (err && typeof err === 'object') {
    const any = err as Record<string, unknown>;
    const code = typeof any.code === 'string' ? any.code : 'n/a';
    const msg =
      typeof any.message === 'string' && any.message.length > 0
        ? (any.message as string)
        : safeStringify(err);
    return { type, code, msg };
  }
  return { type, code: 'n/a', msg: safeStringify(err) };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function clearPrivyLocalStorage(): number {
  let removed = 0;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith('privy:')) {
      localStorage.removeItem(key);
      removed++;
    }
  }
  return removed;
}

function useTelegramWebApp() {
  const [, force] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      tries++;
      if (window.Telegram?.WebApp?.initData !== undefined || tries > 10) {
        force((n) => n + 1);
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);
  return window.Telegram?.WebApp;
}

export default function App() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();

  const completeLockRef = useRef(false);
  const restoredLockRef = useRef(false);
  const [accessTokenPreview, setAccessTokenPreview] = useState<string | null>(null);

  const { login, state } = useLoginWithTelegram({
    onComplete: ({ user: u, isNewUser, wasAlreadyAuthenticated, loginMethod }) => {
      if (completeLockRef.current) return;
      completeLockRef.current = true;
      window.setTimeout(() => {
        completeLockRef.current = false;
      }, 1000);
      (async () => {
        let token: string | null = null;
        try {
          token = await getAccessToken();
        } catch (e) {
          console.warn('[privy] getAccessToken failed in onComplete', e);
        }
        const preview = token ? token.slice(0, 12) + '…' : 'n/a';
        setAccessTokenPreview(preview);
        emitToast(
          'success',
          [
            `登录成功`,
            `method=${loginMethod ?? 'n/a'}`,
            `user=${u.id}`,
            `new=${isNewUser}`,
            `restored=${wasAlreadyAuthenticated}`,
            `token=${preview}`,
          ].join(' | '),
        );
      })();
    },
    onError: (err) => {
      const { type, code, msg } = normalizeError(err);
      emitToast('error', `登录失败 | type=${type} | code=${code} | msg=${msg}`);
      console.error('[privy] onError raw:', err);
    },
  });

  useEffect(() => {
    if (!ready) return;
    if (authenticated && !restoredLockRef.current && !completeLockRef.current) {
      restoredLockRef.current = true;
      (async () => {
        let token: string | null = null;
        try {
          token = await getAccessToken();
        } catch (e) {
          console.warn('[privy] getAccessToken failed on restore', e);
        }
        const preview = token ? token.slice(0, 12) + '…' : 'n/a';
        setAccessTokenPreview(preview);
        emitToast('info', `检测到已登录，自动恢复 | user=${user?.id ?? 'n/a'} | token=${preview}`);
      })();
    }
    if (!authenticated) {
      restoredLockRef.current = false;
      setAccessTokenPreview(null);
    }
  }, [ready, authenticated, user?.id, getAccessToken]);

  const handleLogin = useCallback(async () => {
    try {
      await login();
    } catch (err) {
      const { type, code, msg } = normalizeError(err);
      emitToast('error', `login() 抛错 | type=${type} | code=${code} | msg=${msg}`);
      console.error('[privy] login() throw:', err);
    }
  }, [login]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (e) {
      console.warn('[privy] logout rejected (swallowed):', e);
    }
    const removed = clearPrivyLocalStorage();
    emitToast('info', `已登出 | localStorage privy:* 清理 ${removed} 条`);
  }, [logout]);

  const tg = useTelegramWebApp();
  const initDataPrefix = tg?.initData ? tg.initData.slice(0, 40) : null;
  const tgUnsafeUser = tg?.initDataUnsafe?.user ?? null;

  const debugState = useMemo(
    () => ({
      ready,
      authenticated,
      loginState: state.status,
      loginError:
        state.status === 'error' ? normalizeError((state as { error: unknown }).error) : null,
      user,
      accessTokenPreview,
      telegramEnv: {
        webAppPresent: Boolean(tg),
        initDataPresent: Boolean(tg?.initData),
        initDataPrefix,
        initDataUnsafeUser: tgUnsafeUser,
      },
      buildBase: import.meta.env.BASE_URL,
    }),
    [ready, authenticated, state, user, accessTokenPreview, tg, initDataPrefix, tgUnsafeUser],
  );

  const loading = state.status === 'loading';

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '24px 16px',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        background: '#fafafa',
        color: '#111',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Privy × Telegram Mini App Demo</h1>
        <p style={{ color: '#555', fontSize: 13, marginTop: 6 }}>
          Minimal login verification. Check the toast panel on the top-right for per-step
          success / failure. Open DevTools console for raw error objects.
        </p>

        <div style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
          {!authenticated ? (
            <button
              onClick={handleLogin}
              disabled={!ready || loading}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                border: '1px solid #2272d6',
                background: loading ? '#9ebde8' : '#2272d6',
                color: '#fff',
                borderRadius: 6,
                cursor: !ready || loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Logging in…' : 'Log in with Telegram'}
            </button>
          ) : (
            <button
              onClick={handleLogout}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                border: '1px solid #d2362c',
                background: '#fff',
                color: '#d2362c',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Log out
            </button>
          )}
          <button
            onClick={() => {
              const removed = clearPrivyLocalStorage();
              emitToast('info', `手动清理 localStorage privy:* ${removed} 条`);
            }}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              border: '1px solid #bbb',
              background: '#fff',
              color: '#333',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Clear privy:* localStorage
          </button>
        </div>

        <pre
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            background: '#fff',
            border: '1px solid #e3e3e3',
            borderRadius: 8,
            padding: 12,
            overflow: 'auto',
            maxHeight: '60vh',
            margin: 0,
          }}
        >
          {JSON.stringify(debugState, null, 2)}
        </pre>
      </div>
    </div>
  );
}
