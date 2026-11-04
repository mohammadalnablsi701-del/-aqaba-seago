import React from "react";

// Reuse the exact approved Direction A Customer icon in every in-app logo.
// Vite's BASE_URL keeps the asset correct on Render (/), GitHub Pages and native builds.
export default function BrandLogo({ compact = false }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"}>
      <img
        className="brand__mark"
        src={`${import.meta.env.BASE_URL}app-customer.svg`}
        alt="Aqaba SeaGo logo"
        width={58}
        height={58}
        draggable={false}
      />
      {!compact && (
        <div className="brand__word">
          <strong>SeaGo</strong>
          <span>AQABA</span>
        </div>
      )}
    </div>
  );
}
