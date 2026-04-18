/**
 * Business backend /login integration.
 *
 * Protocol (see brief):
 *   POST {base}/login
 *   headers:
 *     Content-Type: application/json
 *     Authorization: JSON.stringify({pf,referral_code,method,access_token,identity_token,address})
 *     biz-pf: <enum value as string, e.g. "4">
 *     LANG: zh-cn
 *   body: empty (no body)
 *
 *   response envelope: { errno, msg, data }
 *     success: errno in {"0", 0, "200"}, data is either a JWT string or { access_token, wallet_approve_state }
 */

export type LoginMethod = 'wallet' | 'email' | 'telegram';

export interface ExchangeInput {
  access_token: string;
  identity_token: string;
  address: string;
  method: LoginMethod;
  referral_code?: string | null;
}

export interface ExchangeSuccess {
  ok: true;
  businessJwt: string;
  walletApproveState: unknown;
  raw: unknown;
}

export interface ExchangeFailure {
  ok: false;
  errno: string;
  msg: string;
  httpStatus: number;
  raw: unknown;
}

export type ExchangeResult = ExchangeSuccess | ExchangeFailure;

export const ERRNO_SUCCESS = ['0', 0, '200'] as const;
export const ERRNO_TOKEN_INVALID = '104';
export const ERRNO_NOT_WHITELISTED = '10010012';

function isSuccess(errno: unknown): boolean {
  return (ERRNO_SUCCESS as readonly (string | number)[]).includes(errno as string | number);
}

function extractBusinessJwt(data: unknown): string | null {
  if (typeof data === 'string' && data.length > 0) return data;
  if (data && typeof data === 'object') {
    const token = (data as Record<string, unknown>).access_token;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return null;
}

function extractWalletApproveState(data: unknown): unknown {
  if (data && typeof data === 'object') {
    return (data as Record<string, unknown>).wallet_approve_state;
  }
  return undefined;
}

export async function exchangeJwt(
  base: string,
  bizPf: string,
  input: ExchangeInput,
): Promise<ExchangeResult> {
  const url = `${base.replace(/\/$/, '')}/login`;

  const authorization = JSON.stringify({
    pf: 'privy',
    referral_code: input.referral_code ?? null,
    method: input.method,
    access_token: input.access_token,
    identity_token: input.identity_token,
    address: input.address,
  });

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
        'biz-pf': bizPf,
        LANG: 'zh-cn',
      },
    });
  } catch (e) {
    return {
      ok: false,
      errno: 'network_error',
      msg: e instanceof Error ? e.message : String(e),
      httpStatus: 0,
      raw: e,
    };
  }

  let raw: unknown = null;
  const text = await resp.text();
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = text;
  }

  if (!resp.ok) {
    const env = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null);
    return {
      ok: false,
      errno: String(env?.errno ?? resp.status),
      msg: String(env?.msg ?? `HTTP ${resp.status}`),
      httpStatus: resp.status,
      raw,
    };
  }

  const env = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const errno = env.errno;

  if (!isSuccess(errno)) {
    return {
      ok: false,
      errno: String(errno ?? 'unknown'),
      msg: typeof env.msg === 'string' && env.msg.length > 0 ? env.msg : 'unknown error',
      httpStatus: resp.status,
      raw,
    };
  }

  const jwt = extractBusinessJwt(env.data);
  if (!jwt) {
    return {
      ok: false,
      errno: String(errno),
      msg: 'success errno but no access_token in data',
      httpStatus: resp.status,
      raw,
    };
  }

  return {
    ok: true,
    businessJwt: jwt,
    walletApproveState: extractWalletApproveState(env.data),
    raw,
  };
}

export function previewJwt(jwt: string): string {
  return jwt.length > 12 ? jwt.slice(0, 12) + '…' : jwt;
}
