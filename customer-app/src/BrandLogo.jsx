import React from "react";

export default function BrandLogo({ compact = false }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"}>
      <svg className="brand__mark" viewBox="0 0 120 90" role="img" aria-label="Aqaba SeaGo logo">
        <defs>
          <linearGradient id="waveA" x1="0" x2="1">
            <stop offset="0" stopColor="#00BCD4" />
            <stop offset="1" stopColor="#0288D1" />
          </linearGradient>
        </defs>
        <circle cx="77" cy="22" r="10" fill="#FDB813" />
        <path d="M18 56 C36 36, 53 33, 72 43 C86 50, 93 45, 109 32 C101 55, 89 69, 70 70 C49 72, 31 66, 18 56Z" fill="#0B3D91"/>
        <path d="M12 63 C31 48, 51 47, 69 55 C84 62, 94 60, 108 51 C97 71, 84 80, 65 80 C43 80, 25 72, 12 63Z" fill="url(#waveA)"/>
        <path d="M27 51 L47 29 L58 42 L72 32 L84 45 C63 39, 47 42, 27 51Z" fill="#5BA4C9" opacity=".85"/>
        <path d="M17 72 C34 61, 48 62, 60 67 C72 72, 87 72, 102 64" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round"/>
      </svg>
      {!compact && (
        <div className="brand__word">
          <span>Aqaba</span> <strong>SeaGo</strong>
        </div>
      )}
    </div>
  );
}
