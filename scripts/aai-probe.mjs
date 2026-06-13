#!/usr/bin/env node
// Verify an AssemblyAI key against the real realtime API in ~15 seconds.
//
//   node scripts/aai-probe.mjs YOUR_API_KEY            (macOS: speech auto-generated)
//   node scripts/aai-probe.mjs YOUR_API_KEY audio.wav  (any 16kHz/16-bit mono WAV)
//
// It mints a temporary token, opens the same WebSocket the app uses, streams the
// audio like a live mic, and prints every Turn message. If you see transcripts
// here, the app's "Live · AssemblyAI" path will work with this key.
import { execSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const KEY = process.argv[2] || process.env.ASSEMBLYAI_API_KEY;
if (!KEY) {
  console.error("usage: node scripts/aai-probe.mjs <ASSEMBLYAI_API_KEY> [wav-file]");
  process.exit(2);
}

const SAY_TEXT =
  "We are basically the open A I for legal. Our round is oversubscribed with tier one V Cs. " +
  "I am in founder mode, locked in, no days off. Humbled to announce we are a generational company.";

function getWav() {
  const arg = process.argv[3];
  if (arg) {
    if (!existsSync(arg)) {
      console.error(`wav file not found: ${arg}`);
      process.exit(2);
    }
    return arg;
  }
  try {
    const dir = mkdtempSync(join(tmpdir(), "aai-probe-"));
    const aiff = join(dir, "probe.aiff");
    const wav = join(dir, "probe16.wav");
    execSync(`say -o "${aiff}" "${SAY_TEXT}"`);
    execSync(`afconvert -f WAVE -d LEI16@16000 -c 1 "${aiff}" "${wav}"`);
    return wav;
  } catch {
    console.error("couldn't synthesize audio (say/afconvert are macOS-only) — pass a 16kHz mono PCM16 WAV as the 2nd arg");
    process.exit(2);
  }
}

/** Extract raw PCM from a WAV file (assumes PCM16 mono — what afconvert wrote). */
function pcmFromWav(path) {
  const buf = readFileSync(path);
  const idx = buf.indexOf(Buffer.from("data"));
  if (idx < 0) {
    console.error("no data chunk in wav");
    process.exit(2);
  }
  return buf.subarray(idx + 8);
}

const wav = getWav();
const pcm = pcmFromWav(wav);
console.log(`[probe] audio: ${(pcm.length / 32000).toFixed(1)}s of 16kHz PCM16`);

console.log("[probe] minting temporary token…");
const tokRes = await fetch(
  "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
  { headers: { Authorization: KEY } },
);
if (!tokRes.ok) {
  console.error(`[probe] TOKEN FAILED: HTTP ${tokRes.status} — bad key?`);
  console.error(await tokRes.text());
  process.exit(1);
}
const { token } = await tokRes.json();
console.log("[probe] token OK — connecting…");

const ws = new WebSocket(
  `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&format_turns=true&token=${encodeURIComponent(token)}`,
);

let finals = 0;
let timer = null;

ws.on("open", () => {
  console.log("[probe] socket open — streaming audio in 100ms chunks…");
  const CHUNK = 3200; // 100ms of 16kHz PCM16
  let off = 0;
  timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return clearInterval(timer);
    if (off >= pcm.length) {
      clearInterval(timer);
      // a little trailing silence so the last turn endpoints, then terminate
      ws.send(Buffer.alloc(CHUNK * 10));
      setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: "Terminate" }));
        } catch {}
      }, 1500);
      return;
    }
    ws.send(pcm.subarray(off, Math.min(off + CHUNK, pcm.length)));
    off += CHUNK;
  }, 100);
});

ws.on("message", (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (m.type === "Begin") console.log(`[probe] session began (id ${m.id})`);
  else if (m.type === "Turn") {
    const tag = m.end_of_turn ? (m.turn_is_formatted ? "FINAL(fmt)" : "FINAL(raw)") : "partial   ";
    console.log(`[probe] ${tag} | ${m.transcript}`);
    if (m.end_of_turn && m.transcript?.trim()) finals++;
  } else if (m.type === "Termination") {
    console.log(`[probe] terminated: ${m.audio_duration_seconds ?? "?"}s processed`);
  }
});

ws.on("close", (code) => {
  if (timer) clearInterval(timer);
  if (finals > 0) {
    console.log(`\n✅ PASS — got ${finals} final transcript(s). This key works; the app will show "Live · AssemblyAI".`);
    process.exit(0);
  }
  console.error(`\n❌ FAIL — socket closed (code ${code}) with no finals. Check the key / network.`);
  process.exit(1);
});
ws.on("error", (e) => console.error("[probe] ws error:", e.message));
