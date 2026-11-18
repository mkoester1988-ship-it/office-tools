export const APP_VERSION = '1.4.0';

export const isElectron = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.electronAPI);

export interface PcSyncPairing {
  baseUrl: string; // e.g. http://192.168.2.21:3847
  token: string;
}

const SYNC_KEY = 'pdfreader_pc_sync';

export function getPcSyncPairing(): PcSyncPairing | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PcSyncPairing;
    if (parsed.baseUrl && parsed.token) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function setPcSyncPairing(urlInput: string): PcSyncPairing | null {
  try {
    const u = new URL(urlInput.trim());
    const token = u.searchParams.get('token') ?? '';
    if (!token) return null;
    const pairing: PcSyncPairing = {
      baseUrl: `${u.protocol}//${u.host}`,
      token,
    };
    localStorage.setItem(SYNC_KEY, JSON.stringify(pairing));
    return pairing;
  } catch {
    return null;
  }
}

export async function uploadToPc(
  fileName: string,
  bytes: Uint8Array
): Promise<{ ok: boolean; savedName?: string; error?: string }> {
  const pairing = getPcSyncPairing();
  if (!pairing) {
    return { ok: false, error: 'Bitte zuerst mit dem PC koppeln (Sync-Link / QR).' };
  }
  try {
    const res = await fetch(
      `${pairing.baseUrl}/api/upload?token=${encodeURIComponent(pairing.token)}&name=${encodeURIComponent(fileName)}`,
      {
        method: 'POST',
        body: new Blob([new Uint8Array(bytes)]),
      }
    );
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, savedName: data.savedName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function saveBytesBrowserFallback(
  fileName: string,
  bytes: Uint8Array,
  mimeType = 'application/pdf'
): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickLocalFilesWeb(
  accept = '.pdf,image/*'
): Promise<{ name: string; ext: string; data: Uint8Array }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const out: { name: string; ext: string; data: Uint8Array }[] = [];
      for (const f of files) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const dotIdx = f.name.lastIndexOf('.');
        const ext = dotIdx >= 0 ? f.name.slice(dotIdx).toLowerCase() : '.pdf';
        out.push({ name: f.name, ext, data: buf });
      }
      resolve(out);
    };
    input.click();
  });
}
