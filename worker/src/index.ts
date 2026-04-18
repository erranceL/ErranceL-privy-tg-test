/**
 * privy-tg-test worker
 *
 * Two endpoints:
 *   POST /tg/webhook  Telegram → handle /start
 *   POST /log         Frontend → forward toast/error logs to LOG_CHAT_ID
 *
 * Env bindings (see wrangler.toml):
 *   TG_BOT_TOKEN      secret, bot token
 *   WEBHOOK_SECRET    secret, random string matching X-Telegram-Bot-Api-Secret-Token header
 *   LOG_CHAT_ID       var, chat id to forward logs to (e.g. -100xxxxxxxxxx for supergroups)
 *   ALLOWED_ORIGIN    var, origin allowed to POST /log (e.g. https://errancel.github.io)
 */

export interface Env {
  TG_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  LOG_CHAT_ID: string;
  ALLOWED_ORIGIN: string;
}

const TG_API = 'https://api.telegram.org';

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  if (origin === allowed) {
    return {
      'access-control-allow-origin': allowed,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
  }
  return {};
}

async function tgCall(env: Env, method: string, body: unknown): Promise<Response> {
  return fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function sendMessage(
  env: Env,
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra,
  });
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const provided = request.headers.get('x-telegram-bot-api-secret-token');
  if (!provided || provided !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let update: any;
  try {
    update = await request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const msg = update?.message;
  if (!msg || typeof msg.text !== 'string') {
    return json({ ok: true, ignored: 'no text message' });
  }

  const chatId = msg.chat?.id;
  if (!chatId) return json({ ok: true, ignored: 'no chat id' });

  const text = msg.text.trim();

  const firstToken = text.split(/\s+/)[0] ?? '';
  const command = firstToken.split('@')[0];

  if (command === '/start') {
    const chatType = msg.chat?.type ?? 'unknown';
    const reply = [
      'privy tg test demo, click menu to open',
      '',
      `chat_id: \`${chatId}\` (${chatType})`,
    ].join('\n');
    await sendMessage(env, chatId, reply, { parse_mode: 'Markdown' });
    return json({ ok: true });
  }

  return json({ ok: true, ignored: 'unknown command' });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatLogPayload(payload: any): string {
  const kind = String(payload?.kind ?? 'info').toLowerCase();
  const emoji = kind === 'error' ? '[ERR]' : kind === 'success' ? '[OK ]' : '[ i ]';
  const msg = String(payload?.msg ?? '(no msg)');
  const ctx = payload?.ctx;
  const ua = String(payload?.ua ?? '');
  const url = String(payload?.url ?? '');
  const ts = new Date(Number(payload?.ts) || Date.now()).toISOString();

  const parts = [
    `<b>${emoji} ${escapeHtml(kind)}</b>  <code>${escapeHtml(ts)}</code>`,
    `<b>msg</b>: ${escapeHtml(msg)}`,
  ];
  if (url) parts.push(`<b>url</b>: <code>${escapeHtml(url)}</code>`);
  if (ua) parts.push(`<b>ua</b>: <code>${escapeHtml(ua.slice(0, 120))}</code>`);
  if (ctx) {
    let ctxStr: string;
    try {
      ctxStr = typeof ctx === 'string' ? ctx : JSON.stringify(ctx, null, 2);
    } catch {
      ctxStr = String(ctx);
    }
    if (ctxStr.length > 2500) ctxStr = ctxStr.slice(0, 2500) + '\n…(truncated)';
    parts.push(`<pre>${escapeHtml(ctxStr)}</pre>`);
  }

  return parts.join('\n');
}

async function handleLog(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('origin') ?? '';
  const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

  if (!cors['access-control-allow-origin']) {
    return new Response('origin not allowed', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400, cors);
  }

  const text = formatLogPayload(payload);

  try {
    const resp = await sendMessage(env, env.LOG_CHAT_ID, text, { parse_mode: 'HTML' });
    if (!resp.ok) {
      const body = await resp.text();
      return json({ ok: false, upstream: resp.status, body }, 502, cors);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500, cors);
  }

  return json({ ok: true }, 200, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname === '/log') {
      const origin = request.headers.get('origin') ?? '';
      return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
    }

    if (request.method === 'POST' && url.pathname === '/tg/webhook') {
      return handleTelegramWebhook(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/log') {
      return handleLog(request, env);
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        service: 'privy-tg-test-worker',
        endpoints: ['POST /tg/webhook', 'POST /log'],
      });
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
