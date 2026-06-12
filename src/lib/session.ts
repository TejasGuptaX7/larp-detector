// Shared session state: one microphone + one VoiceEngine + the two enrolled
// voice profiles, carried from the enroll screen into the live screen.
//
// We deliberately use a SINGLE mic for both speakers. The two audio streams
// are never combined into one identity — every spoken phrase is matched to a
// profile by the voice itself, so A and B stay separated even on one device.

import { openMic, type MicHandle } from "./audio";
import { VoiceEngine, type VoiceProfile } from "./voice";

type Session = {
  mic: MicHandle | null;
  engine: VoiceEngine | null;
  profiles: VoiceProfile[]; // [A, B]
  deviceId?: string;
};

const session: Session = {
  mic: null,
  engine: null,
  profiles: [],
};

/** Acquire (or reuse) the shared mic + voice engine. */
export async function ensureMic(deviceId?: string): Promise<{
  mic: MicHandle;
  engine: VoiceEngine;
}> {
  if (session.mic && session.engine && session.deviceId === deviceId) {
    return { mic: session.mic, engine: session.engine };
  }
  releaseMic();
  const mic = await openMic(deviceId);
  const engine = new VoiceEngine(mic.stream);
  session.mic = mic;
  session.engine = engine;
  session.deviceId = deviceId;
  return { mic, engine };
}

export function getMic(): MicHandle | null {
  return session.mic;
}

export function getEngine(): VoiceEngine | null {
  return session.engine;
}

export function getStream(): MediaStream | null {
  return session.mic?.stream ?? null;
}

export function setProfiles(profiles: VoiceProfile[]): void {
  session.profiles = profiles;
}

export function getProfiles(): VoiceProfile[] {
  return session.profiles;
}

export function hasProfiles(): boolean {
  return session.profiles.length >= 2;
}

export function releaseMic(): void {
  session.engine?.dispose();
  session.mic?.stop();
  session.mic = null;
  session.engine = null;
  session.deviceId = undefined;
}

export function resetSession(): void {
  releaseMic();
  session.profiles = [];
}
