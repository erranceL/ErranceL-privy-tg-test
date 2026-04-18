import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  usePrivy,
  useLoginWithTelegram,
  useIdentityToken,
  useCreateWallet,
  type User,
} from '@privy-io/react-auth';
import { emitToast } from './toast';
import {
  exchangeJwt,
  previewJwt,
  ERRNO_NOT_WHITELISTED,
  type LoginMethod,
} from './loginApi';

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

function deriveMethod(loginMethod: string | null | undefined, user: User | null): LoginMethod {
  if (loginMethod === 'email') return 'email';
  if (user?.email) return 'email';
  return 'wallet';
}

function deriveAddress(user: User | null): string | null {
  if (!user) return null;
  if (user.wallet?.address) return user.wallet.address;
  const linked = (user.linkedAccounts ?? []) as unknown as Array<Record<string, unknown>>;
  for (const acc of linked) {
    if (typeof acc.address === 'string' && acc.address.length > 0) return acc.address;
  }
  return null;
}

export default function App() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { createWallet } = useCreateWallet({
    onError: (err) => {
      console.warn('[privy] createWallet onError', err);
    },
  });

  const completeLockRef = useRef(false);
  const restoredLockRef = useRef(false);
  const exchangingRef = useRef(false);
  const [accessTokenPreview, setAccessTokenPreview] = useState<string | null>(null);
  const [businessJwtPreview, setBusinessJwtPreview] = useState<string | null>(null);
  const [loginApiState, setLoginApiState] = useState<
    { kind: 'idle' } | { kind: 'pending' } | { kind: 'success' } | { kind: 'error'; errno: string; msg: string }
  >({ kind: 'idle' });

  const LOGIN_API_BASE = import.meta.env.VITE_LOGIN_API_BASE ?? '';
  const BIZ_PF = import.meta.env.VITE_BIZ_PF ?? '4';

  const runLoginExchange = useCallback(
    async (opts: { restored: boolean; loginMethod?: string | null }): Promise<void> => {
      if (exchangingRef.current) return;
      if (!LOGIN_API_BASE) {
        emitToast(
          'info',
          '未配置 VITE_LOGIN_API_BASE，跳过业务 /login 调用（仅验证 Privy 链路）',
        );
        return;
      }
      exchangingRef.current = true;
      setLoginApiState({ kind: 'pending' });
      try {
        const [accessToken, identityTokenVal] = await Promise.all([
          getAccessToken().catch(() => null),
          Promise.resolve(identityToken),
        ]);

        if (!accessToken) {
          emitToast('error', '[/login 跳过] Privy accessToken 为空');
          setLoginApiState({ kind: 'error', errno: 'no_access_token', msg: 'missing privy access_token' });
          return;
        }
        if (!identityTokenVal) {
          emitToast('error', '[/login 跳过] Privy identityToken 为空（useIdentityToken 还没好？）');
          setLoginApiState({ kind: 'error', errno: 'no_identity_token', msg: 'missing privy identity_token' });
          return;
        }

        let address = deriveAddress(user);
        if (!address) {
          emitToast('info', '[/login 前置] 无 address，调用 createWallet() 补钱包…');
          try {
            const w = await createWallet();
            address = w?.address ?? null;
            emitToast('info', `[/login 前置] createWallet OK | addr=${address ? address.slice(0, 10) + '…' : 'n/a'}`);
          } catch (e) {
            const n = normalizeError(e);
            emitToast('error', `[/login 跳过] createWallet 抛错 | code=${n.code} | msg=${n.msg}`);
            setLoginApiState({ kind: 'error', errno: 'create_wallet_failed', msg: n.msg });
            return;
          }
          if (!address) {
            emitToast('error', '[/login 跳过] createWallet 返回空 address');
            setLoginApiState({ kind: 'error', errno: 'no_address', msg: 'createWallet returned no address' });
            return;
          }
        }

        const method = deriveMethod(opts.loginMethod, user);

        emitToast(
          'info',
          `[/login 开始] ${opts.restored ? '(restored)' : ''} method=${method} addr=${address.slice(0, 8)}…`,
        );

        const result = await exchangeJwt(LOGIN_API_BASE, BIZ_PF, {
          access_token: accessToken,
          identity_token: identityTokenVal,
          address,
          method,
        });

        if (result.ok) {
          setBusinessJwtPreview(previewJwt(result.businessJwt));
          setLoginApiState({ kind: 'success' });
          emitToast(
            'success',
            `[/login OK] jwt=${previewJwt(result.businessJwt)} wallet_approve_state=${String(result.walletApproveState)}`,
          );
          return;
        }

        setLoginApiState({ kind: 'error', errno: result.errno, msg: result.msg });
        emitToast(
          'error',
          `[/login FAIL] errno=${result.errno} | http=${result.httpStatus} | msg=${result.msg}`,
        );

        if (result.errno === ERRNO_NOT_WHITELISTED) {
          emitToast(
            'info',
            `检测到 errno=${ERRNO_NOT_WHITELISTED}（不在白名单），自动清理 Privy session 防止死循环`,
          );
          try {
            await logout();
          } catch (e) {
            console.warn('[privy] logout after 10010012 failed', e);
          }
          clearPrivyLocalStorage();
        }
      } catch (e) {
        const { type, code, msg } = normalizeError(e);
        emitToast('error', `[/login throw] type=${type} | code=${code} | msg=${msg}`);
        setLoginApiState({ kind: 'error', errno: code, msg });
      } finally {
        exchangingRef.current = false;
      }
    },
    [LOGIN_API_BASE, BIZ_PF, getAccessToken, identityToken, user, logout, createWallet],
  );

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
            `[privy OK]`,
            `method=${loginMethod ?? 'n/a'}`,
            `user=${u.id}`,
            `new=${isNewUser}`,
            `restored=${wasAlreadyAuthenticated}`,
            `token=${preview}`,
          ].join(' | '),
        );

        await runLoginExchange({ restored: false, loginMethod });
      })();
    },
    onError: (err) => {
      const { type, code, msg } = normalizeError(err);
      emitToast('error', `[privy FAIL] type=${type} | code=${code} | msg=${msg}`);
      console.error('[privy] onError raw:', err);
      if (typeof err === 'string' && err === 'exited_auth_flow') {
        queueMicrotask(() => {
          void login().catch(() => undefined);
        });
      }
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
        emitToast(
          'info',
          `[privy restored] user=${user?.id ?? 'n/a'} | token=${preview}`,
        );
        await runLoginExchange({ restored: true });
      })();
    }
    if (!authenticated) {
      restoredLockRef.current = false;
      setAccessTokenPreview(null);
      setBusinessJwtPreview(null);
      setLoginApiState({ kind: 'idle' });
    }
  }, [ready, authenticated, user?.id, getAccessToken, runLoginExchange]);

  const handleLogin = useCallback(async () => {
    try {
      await login();
    } catch (err) {
      const { type, code, msg } = normalizeError(err);
      emitToast('error', `[privy login()] throw | type=${type} | code=${code} | msg=${msg}`);
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
      address: deriveAddress(user),
      accessTokenPreview,
      identityTokenPresent: Boolean(identityToken),
      loginApi: {
        base: LOGIN_API_BASE || '(not configured)',
        bizPf: BIZ_PF,
        state: loginApiState,
        businessJwtPreview,
      },
      telegramEnv: {
        webAppPresent: Boolean(tg),
        initDataPresent: Boolean(tg?.initData),
        initDataPrefix,
        initDataUnsafeUser: tgUnsafeUser,
      },
      buildBase: import.meta.env.BASE_URL,
    }),
    [
      ready,
      authenticated,
      state,
      user,
      accessTokenPreview,
      identityToken,
      LOGIN_API_BASE,
      BIZ_PF,
      loginApiState,
      businessJwtPreview,
      tg,
      initDataPrefix,
      tgUnsafeUser,
    ],
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
