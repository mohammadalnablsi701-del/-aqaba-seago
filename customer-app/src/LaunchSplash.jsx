import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { hasApi, listNotifications } from "./api.js";
import { validateStartupSession } from "./startupSession.js";

let startupSession;
function SessionGate({ children, publicEntry }) {
  const [ready, setReady] = useState(Boolean(publicEntry));
  useEffect(() => {
    if (publicEntry) return;
    let cancelled = false;
    // Share the request across StrictMode's effect replay.
    startupSession ||= validateStartupSession({
      hasApi: hasApi(),
      storage: {
        getItem: key => window.localStorage.getItem(key),
        removeItem: key => window.localStorage.removeItem(key)
      },
      validate: listNotifications
    });
    startupSession.then(() => {
      if (!cancelled) setReady(true);
    }, () => {
      if (!cancelled) window.__seagoLaunch?.fail();
    });
    return () => { cancelled = true; };
  }, [publicEntry]);
  return ready ? <>{children}<LaunchReady /></> : null;
}

// Keep the critical HTML splash in place while React commits the real app.
// Its document-scoped clock survives StrictMode and ordinary navigation.
function LaunchReady() {
  useEffect(() => {
    const launch = window.__seagoLaunch;
    if (!launch) return;
    let cancelled = false;
    const handoff = async () => {
      await launch.artworkReady;
      if (cancelled) return;
      // Readiness belongs to React's commit; native release separately gates
      // visibility. A stalled/failed bridge call must not hold a ready app.
      launch.ready();
      if (Capacitor.isNativePlatform()) {
        try {
          await SplashScreen.hide({ fadeOutDuration: 0 });
          if (!cancelled) launch.releaseNative();
        }
        catch { /* Bounded native auto-hide still exposes HTML recovery. */ }
      }
    };
    void handoff();
    return () => { cancelled = true; };
  }, []);
  return null;
}

export default class LaunchSplash extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() {
    window.__seagoLaunch?.fail();
  }

  render() {
    if (this.state.failed) return null;
    return <SessionGate publicEntry={this.props.publicEntry}>{this.props.children}</SessionGate>;
  }
}
