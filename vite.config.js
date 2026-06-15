import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Caminhos relativos são obrigatórios para o Electron carregar os assets
  // via protocolo file:// na versão de produção empacotada.
  base: './',
})
