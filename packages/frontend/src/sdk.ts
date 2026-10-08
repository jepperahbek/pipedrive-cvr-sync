import AppExtensionsSDK, { Command } from '@pipedrive/app-extensions-sdk';

/**
 * Thin wrapper around the Pipedrive App Extensions SDK.
 *
 * - The organization id is NOT available via the SDK; it arrives as a URL query
 *   parameter on the iframe request (selectedIds / id / resource id).
 * - getSignedToken() returns a JWT valid ~5 min; we fetch a fresh one before
 *   each backend call rather than caching it.
 * - When running outside Pipedrive (local dev), initialize() fails; we degrade
 *   to a non-embedded mode where CVR lookups still work but sync is disabled.
 */

let sdk: AppExtensionsSDK | null = null;
let embedded = false;

export function getOrgIdFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search);
  const candidates = [params.get('selectedIds'), params.get('id'), params.get('resourceId')];
  for (const raw of candidates) {
    if (!raw) continue;
    const first = raw.split(',')[0]?.trim();
    if (first && /^\d+$/.test(first)) return Number(first);
  }
  return null;
}

export async function initSdk(): Promise<boolean> {
  try {
    sdk = await new AppExtensionsSDK().initialize({ size: { height: 360 } });
    embedded = true;
  } catch {
    embedded = false;
  }
  return embedded;
}

export function isEmbedded(): boolean {
  return embedded;
}

/** Resize the panel to fit content, clamped to Pipedrive's 100–750px range. */
export async function resizePanel(height: number): Promise<void> {
  if (!sdk) return;
  const clamped = Math.max(100, Math.min(750, Math.ceil(height)));
  try {
    await sdk.execute(Command.RESIZE, { height: clamped });
  } catch {
    /* non-fatal */
  }
}

/** Fetch a fresh signed JWT. Returns null when not embedded. */
export async function getSignedToken(): Promise<string | null> {
  if (!sdk) return null;
  try {
    const result = await sdk.execute(Command.GET_SIGNED_TOKEN);
    return result.token;
  } catch {
    return null;
  }
}

export async function showSnackbar(message: string): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.execute(Command.SHOW_SNACKBAR, { message });
  } catch {
    /* non-fatal */
  }
}

export async function showConfirmation(title: string, description: string): Promise<boolean> {
  if (!sdk) {
    // Local dev fallback: use the browser confirm dialog.
    return window.confirm(`${title}\n\n${description}`);
  }
  try {
    const result = (await sdk.execute(Command.SHOW_CONFIRMATION, {
      title,
      description,
    })) as { confirmed: boolean };
    return Boolean(result.confirmed);
  } catch {
    return false;
  }
}
