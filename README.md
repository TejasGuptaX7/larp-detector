# Stop Larping — the LARP detector

A realtime, two-person "LARP" detector. Two people enroll their voices, then talk.
The app listens on **one microphone**, figures out **who is speaking** by the sound
of their voice, transcribes what each person says, and scores each speaker live on
a 0–100 LARP scale (buzzword theater vs. concrete substance).

```
Landing ─▶ Enroll (build a voice profile per person) ─▶ Live dashboard ─▶ Report
```

## Run it locally

**Frontend** (Vite + React):

```bash
npm install
npm run dev          # http://localhost:5173
```

**Judge server** (optional Layer-2 AI scoring — the app works without it):

```bash
cd server
cp .env.example .env # add your CURSOR_API_KEY
npm install
npm run start        # http://localhost:8787
```

The frontend points at `http://localhost:8787` by default; override with
`VITE_JUDGE_URL` when you deploy the server somewhere else.

> **Transcription (fast + accurate live captions):** uses AssemblyAI realtime.
> Get a key (free $50, no card — [assemblyai.com](https://www.assemblyai.com)),
> then either:
>
> - **Quickest (no server):** put `VITE_ASSEMBLYAI_API_KEY=your-key` in a `.env`
>   file at the project root and rebuild. The browser connects directly. ⚠️ the
>   key ends up in the JS bundle — fine for a personal demo, not for a public site.
> - **Secure (recommended for hosting):** set `ASSEMBLYAI_API_KEY` on the judge
>   server instead; the browser fetches a short-lived token from `/api/aai-token`
>   so the real key never reaches the client.
>
> The status pill shows the active engine: **"Live · AssemblyAI"** when connected.
> With no key it falls back to in-browser [Moonshine](https://huggingface.co/onnx-community/moonshine-base-ONNX)
> ("On-device (slow)") then Web Speech. Speaker attribution is always local. Must
> be served over **HTTPS** (or localhost) for microphone access.

## How the speaker detection works

This is the part that was rebuilt for accuracy:

1. **Raw mic.** We now request audio with `echoCancellation`, `noiseSuppression`
   and `autoGainControl` **off** (`src/lib/audio.ts`). Those "call cleanup" filters
   are great for phone calls but erase the exact loudness and spectral-envelope
   cues that tell two voices apart — with them on, both speakers collapse toward
   the same scrubbed timbre.
2. **A real voice fingerprint.** Each person's enrollment builds a statistical
   profile (`src/lib/voice.ts`): 12 MFCCs + spectral centroid / roll-off /
   flatness / zero-crossing, stored as a per-dimension mean **and variance**, plus
   a robust pitch track (McLeod/NSDF, not raw autocorrelation) with mean, spread
   and range. The enroll screen surfaces all of this so you can see which profile
   is which ("Low · Warm, 122 Hz, 100–150 Hz") and warns you if the two voices are
   too similar to separate reliably.
3. **Stable live attribution.** The gateway (`src/lib/gateway.ts`) scores every
   short audio window against both profiles with a diagonal-Gaussian classifier,
   then smooths the result and only flips the active speaker when the challenger
   leads by a margin (hysteresis) — so attribution stops flickering between A and B.

## Hosting

- **Frontend** is a static build (`npm run build` → `dist/`). Deploy to any static
  host (Vercel, Netlify, Cloudflare Pages, S3). It **must be served over HTTPS** —
  microphone access requires a secure context.
- **Judge server** is a small Node/Express app (`server/`). Deploy to Render,
  Railway, Fly, etc. Set `CURSOR_API_KEY`, then build the frontend with
  `VITE_JUDGE_URL=https://your-judge-host` so it can reach the server.

## Optional: ML-grade speaker recognition

The in-browser detector above is tuned to separate two clearly different voices
well. If you need robustness on **hard cases** (very similar voices, noisy rooms),
there are two ML routes:

- **Picovoice Eagle** — purpose-built on-device speaker recognition, but it gates
  AccessKeys behind account approval, which can be slow/unavailable.
- **onnxruntime-web + a speaker-embedding model** (e.g. ECAPA-TDNN / [wespeaker](https://github.com/wenet-e2e/wespeaker))
  — fully free, **no API key or approval**, runs client-side. You self-host a
  ~10–25 MB `.onnx` model and compute cosine similarity between the enrollment
  embedding and live embeddings. This is the recommended path if the heuristic
  engine isn't enough; it's a self-contained module that can sit behind a flag
  with the current engine as automatic fallback.
