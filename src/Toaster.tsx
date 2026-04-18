import { useEffect, useState } from 'react';
import { dismissToast, onToast, type ToastItem } from './toast';

const SUCCESS_AUTO_DISMISS_MS = 8000;
const INFO_AUTO_DISMISS_MS = 8000;

const colors: Record<ToastItem['kind'], { bg: string; border: string; text: string }> = {
  success: { bg: '#e8f7ef', border: '#2fa96b', text: '#0e5b36' },
  error: { bg: '#fdecec', border: '#d2362c', text: '#7a1712' },
  info: { bg: '#eaf3fd', border: '#2272d6', text: '#123d73' },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => onToast(setItems), []);

  useEffect(() => {
    const timers = items
      .filter((i) => i.kind !== 'error')
      .map((i) => {
        const ttl = i.kind === 'info' ? INFO_AUTO_DISMISS_MS : SUCCESS_AUTO_DISMISS_MS;
        const remaining = Math.max(0, ttl - (Date.now() - i.createdAt));
        return window.setTimeout(() => dismissToast(i.id), remaining);
      });
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [items]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(520px, calc(100vw - 24px))',
        zIndex: 99999,
        pointerEvents: 'none',
      }}
    >
      {items.map((i) => {
        const c = colors[i.kind];
        return (
          <div
            key={i.id}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              color: c.text,
              borderRadius: 8,
              padding: '8px 32px 8px 12px',
              fontSize: 13,
              lineHeight: 1.4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              position: 'relative',
              pointerEvents: 'auto',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          >
            <span style={{ fontWeight: 600, marginRight: 6 }}>[{i.kind}]</span>
            {i.msg}
            <button
              onClick={() => dismissToast(i.id)}
              aria-label="dismiss"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 22,
                height: 22,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: '22px',
                color: c.text,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
