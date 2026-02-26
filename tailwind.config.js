/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#8b5cf6', // Violeta
          accent: '#f59e0b',  // Âmbar (DNA)
          success: '#059669', // Verde Clínico
          danger: '#dc2626',  // Vermelho Alerta
        },
        bg: {
          main: '#f8fafc',    // Slate-50 (Fundo)
          card: '#ffffff',    // Branco
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', "Liberation Mono", "Courier New", 'monospace'],
      }
    },
  },
  plugins: [],
}