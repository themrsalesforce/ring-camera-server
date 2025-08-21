import { RingRestClient } from 'ring-client-api/rest-client';
import { updateConfig } from './config.js';

type StartAuthResult =
  | { twoFactorRequired: true; prompt: string }
  | { twoFactorRequired: false; stored: true };

let pendingClient: RingRestClient | null = null;

export async function startRingAuth(email: string, password: string): Promise<StartAuthResult> {
  const client = new RingRestClient({ email, password });
  try {
    const auth = await client.getCurrentAuth();
    if (auth?.refresh_token) {
      updateConfig({ ringRefreshToken: auth.refresh_token });
      pendingClient = null;
      return { twoFactorRequired: false, stored: true };
    }
    throw new Error('No refresh token returned');
  } catch (e: any) {
    if (client.promptFor2fa) {
      pendingClient = client;
      return { twoFactorRequired: true, prompt: client.promptFor2fa };
    }
    throw e;
  }
}

export async function verifyRingTwoFactor(code: string): Promise<{ stored: true }> {
  if (!pendingClient) {
    throw new Error('No pending Ring authentication. Start with email/password first.');
  }
  const auth = await pendingClient.getAuth(code);
  if (!auth?.refresh_token) {
    throw new Error('Failed to obtain refresh token');
  }
  updateConfig({ ringRefreshToken: auth.refresh_token });
  pendingClient = null;
  return { stored: true };
}


