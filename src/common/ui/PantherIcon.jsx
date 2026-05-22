import React from 'react';

export function PantherIcon({ className = '', style }) {
  return (
    <svg
      viewBox="0 0 100 105"
      fill="currentColor"
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Silhueta principal — cabeça de pantera em perfil 3/4, boca aberta */}
      <path d="
        M 22,12
        C 30,5 50,3 64,8
        C 72,11 75,14 72,14
        C 78,16 86,28 87,44
        C 88,56 83,66 76,72
        C 72,75 67,73 63,77
        C 58,83 53,90 44,91
        C 34,92 20,82 13,68
        C 6,54 6,38 12,26
        C 15,18 18,14 22,12 Z
      " />

      {/* Orelha — triângulo com interior branco */}
      <path d="M 60,7 L 68,1 L 76,10 Z" />
      <path d="M 62,8 L 68,3 L 74,10 Z" fill="white" opacity="0.9" />

      {/* Listras brancas no bocejo — marcas características da pantera */}
      <path d="M 58,26 L 62,24 L 30,50 L 26,52 Z" fill="white" />
      <path d="M 57,36 L 61,34 L 28,62 L 24,64 Z" fill="white" />
      <path d="M 54,48 L 58,46 L 26,72 L 22,74 Z" fill="white" />

      {/* Boca aberta — cavidade branca */}
      <path d="
        M 76,68
        C 82,72 85,80 82,86
        C 78,92 65,92 57,90
        C 58,88 60,85 62,82
        C 67,80 72,78 74,74
        Z
      " fill="white" />

      {/* Presa superior — dente branco */}
      <path d="M 68,72 L 64,85 L 72,74 Z" fill="white" />
      {/* Presa inferior */}
      <path d="M 62,82 L 58,92 L 65,84 Z" fill="white" />
    </svg>
  );
}

export default PantherIcon;
