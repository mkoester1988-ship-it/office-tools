import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import QRCode from 'qrcode';

export interface SyncConfig {
  token: string;
  targetDir: string;
  autoOpenOnReceive: boolean;
}

export interface SyncStatus {
  running: boolean;
  port: number;
  url: string;
  qrDataUrl: string;
  config: SyncConfig;
}

const ALLOWED_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function getLanIp(): string {
  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  return (
    candidates.find((ip) => ip.startsWith('192.168.')) ??
    candidates.find((ip) => ip.startsWith('10.')) ??
    candidates[0] ??
    '127.0.0.1'
  );
}

export class MobileSyncServer {
  private server: http.Server | null = null;
  private port = 3847;
  private config: SyncConfig;
  private configPath: string;
  private onFileReceived: (filePath: string, autoOpen: boolean) => void;

  constructor(
    userDataDir: string,
    defaultDownloadsDir: string,
    onFileReceived: (filePath: string, autoOpen: boolean) => void
  ) {
    this.configPath = path.join(userDataDir, 'sync-config.json');
    this.config = {
      token: crypto.randomBytes(6).toString('hex'),
      targetDir: defaultDownloadsDir,
      autoOpenOnReceive: true,
    };
    this.onFileReceived = onFileReceived;
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SyncConfig>;
      if (parsed.token) this.config.token = parsed.token;
      if (parsed.targetDir) this.config.targetDir = parsed.targetDir;
      if (typeof parsed.autoOpenOnReceive === 'boolean') {
        this.config.autoOpenOnReceive = parsed.autoOpenOnReceive;
      }
    } catch {
      await this.saveConfig();
    }
    await this.start();
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  async updateConfig(patch: Partial<SyncConfig>): Promise<SyncStatus> {
    if (patch.targetDir) this.config.targetDir = patch.targetDir;
    if (typeof patch.autoOpenOnReceive === 'boolean') {
      this.config.autoOpenOnReceive = patch.autoOpenOnReceive;
    }
    if (patch.token) this.config.token = patch.token;
    await this.saveConfig();
    return this.getStatus();
  }

  async regenerateToken(): Promise<SyncStatus> {
    this.config.token = crypto.randomBytes(6).toString('hex');
    await this.saveConfig();
    return this.getStatus();
  }

  async getStatus(): Promise<SyncStatus> {
    const ip = getLanIp();
    const url = `http://${ip}:${this.port}/?token=${this.config.token}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 240,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    return {
      running: Boolean(this.server?.listening),
      port: this.port,
      url,
      qrDataUrl,
      config: { ...this.config },
    };
  }

  private start(): Promise<void> {
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      });

      srv.on('error', () => {
        this.port += 1;
        srv.listen(this.port, '0.0.0.0', () => {
          this.server = srv;
          resolve();
        });
      });

      srv.listen(this.port, '0.0.0.0', () => {
        this.server = srv;
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private findApkPath(): string | null {
    const candidates = [
      path.join(process.resourcesPath || '', 'PDF-Reader-Studio.apk'),
      path.resolve(__dirname, '../release/PDF-Reader-Studio.apk'),
      'D:\\KI-Arbeitsbereich\\PDF-Reader\\release\\PDF-Reader-Studio.apk',
    ];
    for (const c of candidates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        if (require('node:fs').existsSync(c)) return c;
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const token = parsedUrl.searchParams.get('token') ?? '';

    if (parsedUrl.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.getMobileHtml());
      return;
    }

    if (parsedUrl.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
      res.end(
        JSON.stringify({
          name: 'PDF-Reader Studio Sync',
          short_name: 'PDF Sync',
          start_url: `/?token=${encodeURIComponent(token || this.config.token)}`,
          display: 'standalone',
          background_color: '#0f172a',
          theme_color: '#0f172a',
        })
      );
      return;
    }

    if (token !== this.config.token) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Ungültiger Pairing-Code. Bitte QR-Code erneut scannen.' }));
      return;
    }

    if (parsedUrl.pathname === '/api/files' && req.method === 'GET') {
      await fs.mkdir(this.config.targetDir, { recursive: true });
      const entries = await fs.readdir(this.config.targetDir, { withFileTypes: true });
      const files = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;
        const st = await fs.stat(path.join(this.config.targetDir, e.name));
        files.push({ name: e.name, size: st.size, mtimeMs: st.mtimeMs });
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ targetDir: this.config.targetDir, files: files.slice(0, 60) }));
      return;
    }

    if (parsedUrl.pathname === '/api/download' && req.method === 'GET') {
      const fileName = path.basename(parsedUrl.searchParams.get('name') ?? '');
      const fullPath = path.join(this.config.targetDir, fileName);
      const data = await fs.readFile(fullPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      });
      res.end(data);
      return;
    }

    if (parsedUrl.pathname === '/api/apk-version' && req.method === 'GET') {
      const apkPath = this.findApkPath();
      const exists = apkPath ? await fs.access(apkPath).then(() => true).catch(() => false) : false;
      const pkgPath = path.resolve(__dirname, '../package.json');
      let version = '1.4.0';
      try {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
        if (typeof pkg.version === 'string') version = pkg.version;
      } catch {
        // ignore
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ available: exists, version }));
      return;
    }

    if (parsedUrl.pathname === '/api/download-apk' && req.method === 'GET') {
      const apkPath = this.findApkPath();
      if (!apkPath) {
        res.writeHead(404);
        res.end('APK nicht gefunden');
        return;
      }
      const data = await fs.readFile(apkPath);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="PDF-Reader-Studio.apk"',
        'Content-Length': String(data.length),
      });
      res.end(data);
      return;
    }

    if (parsedUrl.pathname === '/api/upload' && req.method === 'POST') {
      const rawName = path.basename(parsedUrl.searchParams.get('name') ?? `Handy_${Date.now()}.pdf`);
      const safeName = rawName.replace(/[<>:"/\\|?*]/g, '_');
      await fs.mkdir(this.config.targetDir, { recursive: true });
      let outPath = path.join(this.config.targetDir, safeName);
      const ext = path.extname(safeName);
      const base = ext ? safeName.slice(0, -ext.length) : safeName;
      let counter = 1;
      while (true) {
        try {
          await fs.access(outPath);
          outPath = path.join(this.config.targetDir, `${base}_${counter}${ext}`);
          counter++;
        } catch {
          break;
        }
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await fs.writeFile(outPath, Buffer.concat(chunks));
      this.onFileReceived(outPath, this.config.autoOpenOnReceive);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, savedName: path.basename(outPath) }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  private getMobileHtml(): string {
    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#0f172a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<link rel="manifest" href="/manifest.webmanifest" />
<title>PDF-Reader Studio · Handy-Sync</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 16px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  h1 { font-size: 20px; margin: 0 0 6px 0; }
  p { margin: 0; color: #94a3b8; font-size: 13.5px; }
  .btn { display: block; width: 100%; padding: 13px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 10px; text-align: center; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-green { background: #10b981; color: #fff; }
  .file-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #334155; gap: 10px; }
  .file-row:last-child { border-bottom: none; }
  .file-name { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a.dl { color: #60a5fa; text-decoration: none; font-weight: 600; font-size: 13px; white-space: nowrap; }
  #status { margin-top: 10px; font-size: 13px; color: #34d399; }
</style>
</head>
<body>
  <div class="card">
    <h1>PDF-Reader Studio · Handy-Sync</h1>
    <p>Ohne Anmeldung direkt mit deinem PC verbunden.</p>
    <input id="fileInput" type="file" accept=".pdf,image/*" multiple style="display:none" />
    <input id="camInput" type="file" accept="image/*" capture="environment" style="display:none" />
    <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">PDF / Bild an PC senden</button>
    <button class="btn btn-green" onclick="document.getElementById('camInput').click()">Dokument abfotografieren & senden</button>
    <a class="btn" style="background:#7c3aed;color:#fff;text-decoration:none;box-sizing:border-box;" id="apkBtn" href="#">Android-App (.apk) installieren / updaten</a>
    <div id="status"></div>
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong>Dateien im PC-Sync-Ordner</strong>
      <button onclick="loadFiles()" style="background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 10px;">Aktualisieren</button>
    </div>
    <div id="list">Lade...</div>
  </div>

<script>
  const params = new URLSearchParams(location.search);
  let token = params.get('token') || localStorage.getItem('pdf_sync_token') || '';
  if (token) localStorage.setItem('pdf_sync_token', token);
  const apkBtn = document.getElementById('apkBtn');
  if (apkBtn) apkBtn.href = '/api/download-apk?token=' + encodeURIComponent(token);

  async function uploadFiles(files) {
    const st = document.getElementById('status');
    for (const f of files) {
      st.textContent = 'Sende ' + f.name + '...';
      const res = await fetch('/api/upload?token=' + encodeURIComponent(token) + '&name=' + encodeURIComponent(f.name), {
        method: 'POST',
        body: f
      });
      const data = await res.json();
      if (!res.ok) { st.textContent = 'Fehler: ' + (data.error || res.status); return; }
      st.textContent = 'Gesendet & auf PC gespeichert: ' + data.savedName;
    }
    loadFiles();
  }

  document.getElementById('fileInput').addEventListener('change', (e) => uploadFiles(e.target.files));
  document.getElementById('camInput').addEventListener('change', (e) => uploadFiles(e.target.files));

  async function loadFiles() {
    const listEl = document.getElementById('list');
    try {
      const res = await fetch('/api/files?token=' + encodeURIComponent(token));
      const data = await res.json();
      if (!res.ok) { listEl.textContent = data.error || 'Nicht gekoppelt'; return; }
      if (!data.files.length) { listEl.textContent = 'Noch keine PDFs/Bilder im Zielordner.'; return; }
      listEl.innerHTML = data.files.map(f =>
        '<div class="file-row"><span class="file-name">' + f.name.replace(/</g,'&lt;') + '</span>' +
        '<a class="dl" href="/api/download?token=' + encodeURIComponent(token) + '&name=' + encodeURIComponent(f.name) + '">Laden</a></div>'
      ).join('');
    } catch (e) {
      listEl.textContent = 'Verbindung fehlgeschlagen.';
    }
  }
  loadFiles();
</script>
</body>
</html>`;
  }
}
