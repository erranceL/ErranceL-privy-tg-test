export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
  createdAt: number;
}

type Listener = (items: ToastItem[]) => void;

const listeners = new Set<Listener>();
let items: ToastItem[] = [];
let seq = 0;

function notify() {
  for (const l of listeners) l(items);
}

export function emitToast(kind: ToastKind, msg: string): number {
  const item: ToastItem = { id: ++seq, kind, msg, createdAt: Date.now() };
  items = [...items, item];
  notify();
  return item.id;
}

export function dismissToast(id: number) {
  items = items.filter((i) => i.id !== id);
  notify();
}

export function onToast(cb: Listener): () => void {
  listeners.add(cb);
  cb(items);
  return () => {
    listeners.delete(cb);
  };
}
