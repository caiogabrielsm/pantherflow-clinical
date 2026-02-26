@echo off
echo ===================================================
echo      Iniciando PantherFlow Clinical (Windows)
echo ===================================================

echo Iniciando o Motor Python (Backend)...
start "PantherFlow - Backend" cmd /k "cd backend && .\venv\Scripts\activate && uvicorn main:app --host 127.0.0.1 --port 8000"

echo Iniciando a Interface (Frontend)...
start "PantherFlow - Frontend" cmd /k "npm run dev"

echo Tudo pronto! O painel do React deve abrir no seu navegador.
echo Para fechar o sistema, basta fechar as duas janelas pretas que abriram.