import { useState } from "react";
import { Landing } from "./screens/Landing";
import { EnrollScreen } from "./screens/EnrollScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { resetSession } from "./lib/session";

type Phase = "landing" | "enroll" | "live";

export function App() {
  const [phase, setPhase] = useState<Phase>("landing");

  function toEnroll() {
    resetSession();
    setPhase("enroll");
  }

  return (
    <div className="app">
      {phase === "landing" && <Landing onLaunch={toEnroll} />}
      {phase === "enroll" && <EnrollScreen onReady={() => setPhase("live")} />}
      {phase === "live" && <LiveScreen onStop={toEnroll} />}
    </div>
  );
}
