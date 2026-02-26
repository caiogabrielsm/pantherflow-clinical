#!/bin/bash

# 1. Liga o Motor Python em segundo plano (o '&' faz ele rodar no fundo)
cd /home/lait/Caio/pantherflow-clinical/backend
./dist/main &
MOTOR_PID=$!

# 2. Espera 2 segundinhos para o motor aquecer
sleep 2

# 3. Liga a Lataria (Frontend + Electron)
cd /home/lait/Caio/pantherflow-clinical
npm run electron:dev

# 4. Quando você fechar a janela do Electron, ele mata o motor para não deixar lixo na memória
kill $MOTOR_PID
