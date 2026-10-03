import React from "react";

export default function BrandLogo({ compact = false }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"}>
      <svg className="brand__mark" viewBox="0 0 64 64" role="img" aria-label="Aqaba SeaGo logo">
        <g fill="none" stroke="#18B8B0" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="32" cy="32" r="18"/>
          <circle cx="32" cy="32" r="10.5"/>
          {[0,45,90,135,180,225,270,315].map(a=><line key={a} x1="32" y1="5.5" x2="32" y2="14" transform={`rotate(${a} 32 32)`}/>)}
          <path d="M25 33c3-4 6 3 9 2 2-.5 3.5-2 5-3"/>
        </g>
      </svg>
      {!compact && (
        <div className="brand__word">
          <strong>SeaGo</strong>
          <span>AQABA</span>
        </div>
      )}
    </div>
  );
}
