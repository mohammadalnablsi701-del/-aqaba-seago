import React, { useEffect, useRef, useState } from "react";
import { heroAssetUrl, shouldPlayHeroVideo } from "./heroVideoPolicy.js";

// The approved Aqaba hero photo is the first paint, not a blank video frame.
// VITE_HERO_VIDEO_ENABLED is deliberately off until a real, licensed 8-second
// H.264 video has been added to customer-app/public/hero-seago.mp4.
const VIDEO_ENABLED = import.meta.env.VITE_HERO_VIDEO_ENABLED === "true";
const ASSET_BASE = import.meta.env.BASE_URL || "/";

function getEnvironment() {
  if (typeof window === "undefined") return { reducedMotion: true };
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    reducedMotion: Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
    saveData: Boolean(conn?.saveData),
    effectiveType: conn?.effectiveType || "",
    isHidden: document.hidden,
  };
}

export default function HeroScene() {
  const root = useRef(null);
  const video = useRef(null);
  const [inView, setInView] = useState(false);
  const [allowed, setAllowed] = useState(() => shouldPlayHeroVideo(getEnvironment()));
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  const poster = heroAssetUrl(ASSET_BASE, "aqaba-hero.jpg");
  const source = heroAssetUrl(ASSET_BASE, "hero-seago.mp4");

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const update = () => setAllowed(shouldPlayHeroVideo(getEnvironment()));
    motion?.addEventListener?.("change", update);
    connection?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      motion?.removeEventListener?.("change", update);
      connection?.removeEventListener?.("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const canShowVideo = VIDEO_ENABLED && allowed && inView && !failed;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!canShowVideo) {
      element.pause();
      setPlaying(false);
      return;
    }
    element.defaultMuted = true;
    element.muted = true;
    const promise = element.play();
    promise?.catch(() => { setFailed(true); setPlaying(false); });
  }, [canShowVideo]);

  return (
    <div ref={root} className="hero-scene hero-scene--media" aria-hidden="true"
      style={{ backgroundImage: `url("${poster}")` }}>
      {canShowVideo && (
        <video ref={video}
          className={playing ? "hero-video hero-video--playing" : "hero-video"}
          autoPlay muted loop playsInline
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
          preload="none" poster={poster}
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => { setFailed(true); setPlaying(false); }}>
          <source src={source} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
