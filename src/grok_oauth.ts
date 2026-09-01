import * as fs from 'fs';
import * as path from 'path';

/** Public Grok CLI OAuth client — same one OpenCode / Hermes use. Not a secret. */
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const DEVICE_AUTHORIZATION_URL = 'https://auth.x.ai/oauth2/device/code';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const USER_AGENT = 'Nova-Home/1.0';

const TOKEN_FILE = path.resolve(process.cwd(), 'grok-oauth.json');
const REFRESH_SKEW_MS = 120_000;

export type GrokTokenState = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type?: string;
};

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
};

function authHeaders() {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };
}

function jwtExpiring(token: string, skewMs = REFRESH_SKEW_MS): boolean {
  const parts = token.split('.');
  if (parts.length < 2) return false;
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (typeof claims?.exp !== 'number') return false;
    return claims.exp * 1000 <= Date.now() + skewMs;
  } catch {
    return false;
  }
}

export function grokOAuthStatus(): {
  loggedIn: boolean;
  expiresAt?: number;
  hint: string;
} {
  const state = readTokens();
  if (!state?.access_token && !state?.refresh_token) {
    return { loggedIn: false, hint: 'not logged in — `!grok login`' };
  }
  if (state.refresh_token && (!state.access_token || jwtExpiring(state.access_token) || Date.now() >= state.expires_at)) {
    return {
      loggedIn: true,
      expiresAt: state.expires_at,
      hint: 'logged in (token stale — will refresh on next call)',
    };
  }
  return { loggedIn: true, expiresAt: state.expires_at, hint: 'logged in' };
}

function readTokens(): GrokTokenState | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw as GrokTokenState;
  } catch {
    return null;
  }
}

function writeTokens(state: GrokTokenState) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(TOKEN_FILE, 0o600);
  } catch {
    /* windows */
  }
}

export function grokOAuthLogout(): string {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
    console.log('[nova] grok oauth: logged out, token file removed');
    return 'Grok OAuth session cleared.';
  }
  return 'No Grok OAuth session to clear.';
}

export async function requestGrokDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
      referrer: 'nova-home',
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`device code failed (${res.status})${detail ? ': ' + detail.slice(0, 200) : ''}`);
  }
  const json = (await res.json()) as DeviceCodeResponse;
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error('device code response missing fields');
  }
  return json;
}

export async function pollGrokDeviceToken(device: DeviceCodeResponse): Promise<GrokTokenState> {
  const expiresInMs = (Number(device.expires_in) > 0 ? Number(device.expires_in) : 300) * 1000;
  const deadline = Date.now() + expiresInMs;
  let intervalMs = Math.max((Number(device.interval) > 0 ? Number(device.interval) : 5) * 1000, 1000);

  while (Date.now() < deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    await new Promise(r => setTimeout(r, Math.min(intervalMs + 3000, remaining || intervalMs)));
    if (Date.now() >= deadline) break;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }).toString(),
    });

    if (res.ok) {
      const tokens = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
      };
      if (!tokens.access_token) throw new Error('token response missing access_token');
      const state: GrokTokenState = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || '',
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        token_type: tokens.token_type || 'Bearer',
      };
      writeTokens(state);
      console.log('[nova] grok oauth: login ok');
      return state;
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    if (body.error === 'access_denied' || body.error === 'authorization_denied') {
      throw new Error('authorization denied');
    }
    if (body.error === 'expired_token') throw new Error('device code expired');
    throw new Error(
      `token poll failed (${res.status})${body.error_description || body.error ? ': ' + (body.error_description || body.error) : ''}`
    );
  }
  throw new Error('device authorization timed out');
}

async function refreshAccessToken(refreshToken: string): Promise<GrokTokenState> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error(
        `refresh 403 — this SuperGrok tier may not have OAuth API access. Set XAI_API_KEY as fallback. ${detail.slice(0, 180)}`
      );
    }
    throw new Error(`refresh failed (${res.status})${detail ? ': ' + detail.slice(0, 180) : ''}`);
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  const state: GrokTokenState = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refreshToken,
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    token_type: tokens.token_type || 'Bearer',
  };
  writeTokens(state);
  console.log('[nova] grok oauth: token refreshed');
  return state;
}

let refreshFlight: Promise<string> | null = null;

/**
 * Bearer for api.x.ai. Prefers OAuth session; falls back to XAI_API_KEY.
 * Never send this token anywhere except https://api.x.ai.
 */
export async function getGrokAccessToken(): Promise<string> {
  const envKey = process.env.XAI_API_KEY?.trim();
  const state = readTokens();

  if (state?.access_token) {
    const stale =
      Date.now() >= (state.expires_at || 0) - REFRESH_SKEW_MS || jwtExpiring(state.access_token);
    if (!stale) return state.access_token;
    if (state.refresh_token) {
      if (!refreshFlight) {
        refreshFlight = refreshAccessToken(state.refresh_token)
          .then(s => s.access_token)
          .finally(() => {
            refreshFlight = null;
          });
      }
      try {
        return await refreshFlight;
      } catch (e) {
        console.warn('[nova] grok oauth refresh failed:', (e as Error).message);
        if (envKey) {
          console.log('[nova] grok: falling back to XAI_API_KEY');
          return envKey;
        }
        throw e;
      }
    }
  }

  if (envKey) return envKey;
  throw new Error('Grok not authenticated. Run `!grok login` (SuperGrok OAuth) or set XAI_API_KEY.');
}

export function grokAuthSource(): 'oauth' | 'api_key' | 'none' {
  const state = readTokens();
  if (state?.access_token || state?.refresh_token) return 'oauth';
  if (process.env.XAI_API_KEY?.trim()) return 'api_key';
  return 'none';
}
