import { onToastAdded, type ToastKind } from './toast';

interface LogPayload {
  kind: ToastKind | 'window_error' | 'unhandled_rejection';
  msg: string;
  ctx?: unknown;
  ts: number;
  url: string;
  ua: string;
}

let endpoint: string | null = null;
let initialized = false;

function fireAndForget(payload: LogPayload) {
  if (!endpoint) return;

  const body = JSON.stringify(payload);

  const sendViaBeacon = () => {
    if (!navigator.sendBeacon) return false;
    try {
      const blob = new Blob([body], { type: 'application/json' });
      return navigator.sendBeacon(endpoint!, blob);
    } catch {
      return false;
    }
  };

  const sendViaFetch = () => {
    fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      mode: 'cors',
    }).catch((e) => {
      console.warn('[remoteLog] fetch failed', e);
    });
  };

  if (document.visibilityState === 'hidden') {
    if (!sendViaBeacon()) sendViaFetch();
  } else {
    sendViaFetch();
  }
}

function buildPayload(
  kind: LogPayload['kind'],
  msg: string,
  ctx?: unknown,
): LogPayload {
  return {
    kind,
    msg,
    ctx,
    ts: Date.now(),
    url: window.location.href,
    ua: navigator.userAgent,
  };
}

export function sendRemoteLog(kind: LogPayload['kind'], msg: string, ctx?: unknown) {
  if (!endpoint) return;
  fireAndForget(buildPayload(kind, msg, ctx));
}

export function initRemoteLog(configuredEndpoint: string | undefined | null) {
  if (initialized) return;
  initialized = true;

  if (!configuredEndpoint) {
    console.info('[remoteLog] disabled (VITE_LOG_ENDPOINT not set)');
    return;
  }
  const trimmed = configuredEndpoint.replace(/\/$/, '');
  endpoint = /\/log$/i.test(trimmed) ? trimmed : trimmed + '/log';
  console.info('[remoteLog] enabled →', endpoint);

  onToastAdded((item) => {
    fireAndForget(buildPayload(item.kind, item.msg));
  });

  window.addEventListener('error', (ev) => {
    const msg = ev?.message || 'window.onerror';
    const ctx = {
      filename: ev?.filename,
      lineno: ev?.lineno,
      colno: ev?.colno,
      errorName: ev?.error?.name,
      errorMessage: ev?.error?.message,
      stack: ev?.error?.stack?.slice(0, 2000),
    };
    fireAndForget(buildPayload('window_error', msg, ctx));
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev?.reason;
    let msg = 'unhandledrejection';
    let ctx: unknown;
    if (typeof reason === 'string') {
      msg = reason;
    } else if (reason && typeof reason === 'object') {
      const r = reason as { message?: string; stack?: string; name?: string };
      msg = r.message || r.name || 'unhandledrejection';
      ctx = { name: r.name, message: r.message, stack: r.stack?.slice(0, 2000) };
    } else {
      try {
        msg = JSON.stringify(reason);
      } catch {
        msg = String(reason);
      }
    }
    fireAndForget(buildPayload('unhandled_rejection', msg, ctx));
  });

  sendRemoteLog('info', 'page_loaded', {
    buildBase: import.meta.env.BASE_URL,
    tgWebApp: Boolean(window.Telegram?.WebApp),
    tgInitDataPresent: Boolean(window.Telegram?.WebApp?.initData),
  });
}
