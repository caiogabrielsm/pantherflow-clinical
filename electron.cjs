const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow, splashWindow;
let backendProcess, viteProcess;
let logStream = null;

function initLog() {
  const logsDir = app.getPath('logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, 'backend.log');
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.write(`\n\n===== PantherFlow iniciado: ${new Date().toISOString()} =====\n`);
  console.log(`[panther] Log do backend em: ${logFile}`);
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function waitFor(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      http.get(url, (res) => {
        res.resume();
        resolve(); // qualquer resposta HTTP = serviço no ar
      }).on('error', () => {
        if (Date.now() >= deadline) reject(new Error(`Timeout esperando: ${url}`));
        else setTimeout(attempt, 700);
      });
    }
    attempt();
  });
}

function spawnLog(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { windowsHide: true, ...opts });
  p.stdout?.on('data', (d) => {
    const s = String(d);
    process.stdout.write(s);
    logStream?.write(s);
  });
  p.stderr?.on('data', (d) => {
    const s = String(d);
    process.stderr.write(s);
    logStream?.write(`[STDERR] ${s}`);
  });
  p.on('exit', (code) => {
    const msg = `[panther] "${cmd}" encerrou (code=${code})\n`;
    console.log(msg);
    logStream?.write(msg);
  });
  return p;
}

// ── Inicialização em modo DESENVOLVIMENTO ─────────────────────────────────────
// Electron inicia o Vite e o uvicorn — o usuário só precisa rodar "npm run electron:dev".

async function startDev() {
  const root = __dirname;
  const backendDir = path.join(root, 'backend');

  // Prefere o Python do venv; se não existir, usa o python do PATH
  const venvPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
  const pythonExe = fs.existsSync(venvPython) ? venvPython : 'python';

  console.log('[panther] Iniciando Vite dev server...');
  viteProcess = spawnLog('npm', ['run', 'dev'], {
    cwd: root,
    shell: true,
  });

  console.log('[panther] Iniciando backend FastAPI...');
  backendProcess = spawnLog(pythonExe, [
    '-m', 'uvicorn', 'main:app',
    '--host', '127.0.0.1',
    '--port', '8000',
    '--reload',
  ], { cwd: backendDir });

  // Aguarda os dois serviços antes de abrir a janela
  await Promise.all([
    waitFor('http://localhost:5173', 30000).catch(() =>
      console.warn('[panther] Vite demorou mais que 30s')
    ),
    waitFor('http://localhost:8000/api/health', 60000).catch(() =>
      console.warn('[panther] Backend demorou mais que 60s')
    ),
  ]);
}

// ── Acorda o WSL2 antes de qualquer operação que use \\wsl.localhost\ ─────────

function startWsl() {
  return new Promise((resolve) => {
    console.log('[panther] Acordando WSL2 e detectando usuário...');
    const timeout = setTimeout(() => {
      console.warn('[panther] WSL2 demorou mais de 35s — continuando com user=ubuntu.');
      resolve('ubuntu');
    }, 35000);

    // Detecta o usuário real do WSL e cria o diretório de processamento
    const p = spawn('wsl', ['bash', '-c', 'mkdir -p ~/pantherflow-clinical/processamento && whoami'], {
      windowsHide: true,
      shell: false,
    });

    let wslUser = 'ubuntu';
    p.stdout?.on('data', (d) => {
      const line = String(d).trim();
      if (line) {
        wslUser = line.split('\n').pop().trim() || wslUser;
        console.log(`[panther] WSL2 ativo. Usuário detectado: ${wslUser}`);
      }
    });
    p.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) console.warn(`[panther] wsl bash retornou code=${code}.`);
      // Aguarda 2s para o UNC path \\wsl.localhost\ ficar acessível
      setTimeout(() => resolve(wslUser), 2000);
    });
    p.on('error', (err) => {
      clearTimeout(timeout);
      console.warn(`[panther] Não foi possível iniciar WSL2: ${err.message}`);
      resolve('ubuntu');
    });
  });
}

// ── Inicialização em modo PRODUÇÃO (app empacotado) ───────────────────────────

async function startProd() {
  const backendExe = path.join(process.resourcesPath, 'backend', 'main.exe');
  const backendCwd = path.join(process.resourcesPath, 'backend');

  if (!fs.existsSync(backendExe)) {
    console.error(`[panther] Backend não encontrado: ${backendExe}`);
    return;
  }

  const wslUser = await startWsl();

  // Garante que docker.exe está no PATH do processo backend.
  // O Docker Desktop instala o CLI em locais fora do PATH padrão do Electron.
  const backendEnv = { ...process.env };
  backendEnv.WSL_USER = wslUser;  // passa o usuário real do WSL para o backend
  const dockerExtraPaths = [
    'C:\\Program Files\\Docker\\Docker\\resources\\bin',
    'C:\\ProgramData\\DockerDesktop\\version-bin',
    'C:\\Program Files\\Docker\\resources\\bin',
  ];
  backendEnv.PATH = [
    backendEnv.PATH,
    ...dockerExtraPaths,
  ].filter(Boolean).join(require('path').delimiter);

  console.log('[panther] Iniciando backend (produção)...');
  backendProcess = spawnLog(backendExe, [], { cwd: backendCwd, env: backendEnv });

  await waitFor('http://localhost:8000/api/health', 60000).catch(() =>
    console.warn('[panther] Backend demorou mais que 60s')
  );
}

// ── Tela de splash ────────────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f172a;
display:flex;flex-direction:column;align-items:center;justify-content:center;
height:100vh;font-family:system-ui,sans-serif;color:white;user-select:none;">
  <div style="font-size:42px;margin-bottom:4px">🐆</div>
  <div style="font-size:22px;font-weight:700;color:#818cf8;letter-spacing:-0.5px">
    PantherFlow Clinical</div>
  <div style="font-size:12px;color:#64748b;margin:6px 0 28px">
    Plataforma de Genômica Clínica</div>
  <div style="width:220px;height:3px;background:#1e293b;border-radius:99px;overflow:hidden">
    <div id="b" style="width:15%;height:100%;background:#6366f1;border-radius:99px;
      transition:width .5s ease"></div></div>
  <div id="msg" style="font-size:11px;color:#475569;margin-top:14px">Iniciando WSL2...</div>
  <script>
    let w=15;
    const msgs=['Iniciando WSL2...','Carregando backend...','Conectando serviços...','Quase lá...'];
    let mi=0;
    setInterval(()=>{
      w=Math.min(w+Math.random()*7,88);
      document.getElementById('b').style.width=w+'%';
      if(w>30&&mi<1){mi=1;document.getElementById('msg').textContent=msgs[1];}
      if(w>55&&mi<2){mi=2;document.getElementById('msg').textContent=msgs[2];}
      if(w>78&&mi<3){mi=3;document.getElementById('msg').textContent=msgs[3];}
    },700);
  </script>
</body></html>`;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// ── Janela principal ──────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'PantherFlow Clinical',
    icon: path.join(__dirname, 'logo.ico'),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Ciclo de vida do app ──────────────────────────────────────────────────────

app.whenReady().then(async () => {
  initLog();
  createSplash();

  if (app.isPackaged) {
    await startProd();
  } else {
    await startDev();
  }

  createMainWindow();
});

app.on('window-all-closed', () => {
  backendProcess?.kill();
  viteProcess?.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});
