const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "pantherflow-clinical",
    width: 1280,
    height: 800,
    title: "PantherFlow Clinical",
    icon: path.join(__dirname, 'logo.png'), // <--- ADICIONE ESTA LINHA AQUI!
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Em modo de desenvolvimento, ele vai carregar o Vite
  // Na versão final, ele vai carregar os arquivos compilados
  const startUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  mainWindow.loadURL(startUrl);

  // Esconde o menu padrão feio do topo
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
