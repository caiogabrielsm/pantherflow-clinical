const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let splashWindow;
let backendProcess;

const BACKEND_PORT = 8000;
const BACKEND_HEALTH_URL = `http://localhost:${BACKEND_PORT}/api/health`;
const BACKEND_TIMEOUT_MS = 60000; // 60s para o uvicorn subir

// Aguarda o backend responder em /api/health antes de carregar a UI.
// Evita a tela branca/erro de conexão que aparecia quando o Electron abria
// antes do uvicorn estar pronto para aceitar conexões.
function waitForBackend(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tentativa() {
      http.get(url, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          agendar();
        }
        res.resume(); // drena o body para liberar o socket
      }).on('error', () => {
        agendar();
      });
    }

    function agendar() {
      if (Date.now() >= deadline) {
        reject(new Error(`Backend não respondeu em ${timeoutMs / 1000}s`));
      } else {
        setTimeout(tentativa, 600);
      }
    }

    tentativa();
  });
}

function startBackend() {
  // Em dev o usuário sobe o backend com `uvicorn main:app` manualmente.
  // Em produção (app empacotado) o exe fica em resources/backend/main.exe.
  if (!app.isPackaged) return;

  const backendExe = path.join(process.resourcesPath, 'backend', 'main.exe');
  const backendCwd = path.join(process.resourcesPath, 'backend');

  if (!fs.existsSync(backendExe)) {
    console.error(`[panther] Backend não encontrado: ${backendExe}`);
    return;
  }

  console.log(`[panther] Iniciando backend: ${backendExe}`);

  backendProcess = spawn(backendExe, [], {
    cwd: backendCwd,
    detached: false,
    windowsHide: true,
  });

  backendProcess.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on('exit', (code) =>
    console.log(`[panther] Backend encerrou com código ${code}`)
  );
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;background:#0f172a;display:flex;flex-direction:column;
  align-items:center;justify-content:center;height:100vh;
  font-family:system-ui,sans-serif;color:white;user-select:none;">
  <div style="font-size:42px;margin-bottom:4px">🐆</div>
  <div style="font-size:22px;font-weight:700;color:#818cf8;letter-spacing:-0.5px">
    PantherFlow Clinical
  </div>
  <div style="font-size:12px;color:#64748b;margin:6px 0 28px">
    Plataforma de Genômica Clínica
  </div>
  <div style="width:220px;height:3px;background:#1e293b;border-radius:99px;overflow:hidden">
    <div id="bar" style="width:20%;height:100%;background:#6366f1;
      border-radius:99px;transition:width .4s ease"></div>
  </div>
  <div id="msg" style="font-size:11px;color:#475569;margin-top:14px">
    Iniciando motor bioinformático...
  </div>
  <script>
    let w = 20;
    setInterval(() => {
      w = Math.min(w + Math.random() * 8, 88);
      document.getElementById('bar').style.width = w + '%';
    }, 600);
  </script>
</body>
</html>`;

  splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'PantherFlow Clinical',
    icon: path.join(__dirname, 'logo.png'),
    show: false, // só exibe após ready-to-show para evitar flash branco
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (app.isPackaged) {
    // Produção: carrega o React compilado localmente via file://
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    // Dev: carrega o Vite dev server
    const devUrl =
      process.env.VITE_DEV_SERVER_URL || `http://localhost:5173`;
    mainWindow.loadURL(devUrl);
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (app.isPackaged) {
    createSplash();
    startBackend();

    try {
      await waitForBackend(BACKEND_HEALTH_URL, BACKEND_TIMEOUT_MS);
      console.log('[panther] Backend pronto — abrindo interface.');
    } catch (err) {
      console.error('[panther] Timeout aguardando backend:', err.message);
      // Abre mesmo assim; o frontend mostrará o erro de conexão
    }
  }

  createMainWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});
