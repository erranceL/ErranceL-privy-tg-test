export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
  createdAt: number;
}

type ListListener = (items: ToastItem[]) => void;
type AddedListener = (item: ToastItem) => void;

const listListeners = new Set<ListListener>();
const addedListeners = new Set<AddedListener>();
let items: ToastItem[] = [];
let seq = 0;

function notifyList() {
  for (const l of listListeners) l(items);
}

export function emitToast(kind: ToastKind, msg: string): number {
  const item: ToastItem = { id: ++seq, kind, msg, createdAt: Date.now() };
  items = [...items, item];
  notifyList();
  for (const l of addedListeners) {
    try {
      l(item);
    } catch (e) {
      console.error('[toast] added listener threw', e);
    }
  }
  return item.id;
}

export function dismissToast(id: number) {
  items = items.filter((i) => i.id !== id);
  notifyList();
}

export function onToast(cb: ListListener): () => void {
  listListeners.add(cb);
  cb(items);
  return () => {
    listListeners.delete(cb);
  };
}

export function onToastAdded(cb: AddedListener): () => void {
  addedListeners.add(cb);
  return () => {
    addedListeners.delete(cb);
  };
}
