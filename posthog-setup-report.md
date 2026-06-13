<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics across the full LARP Detector stack — React/Vite frontend and Express/Node.js backend.

**Frontend (`posthog-js` + `@posthog/react`):** PostHog is initialized in `src/main.tsx` using environment variables (`VITE_POSTHOG_PROJECT_TOKEN`, `VITE_POSTHOG_HOST`), and the app is wrapped in `<PostHogProvider>`. Components use the `usePostHog()` hook to capture events without directly importing the library. The `judgeClient` passes the user's PostHog distinct ID and session ID as `X-POSTHOG-DISTINCT-ID` / `X-POSTHOG-SESSION-ID` headers on every API call, so frontend and server events are automatically correlated.

**Backend (`posthog-node`):** A `PostHog` client instance is created in `server/src/index.ts`, reading the project token and host from environment variables (`POSTHOG_API_KEY`, `POSTHOG_HOST`). Each API route reads the forwarded distinct ID from the request header and attaches it to server-side events. Graceful shutdown hooks ensure the event queue is flushed on process exit.

| Event | Description | File |
|---|---|---|
| `detector_launched` | User clicks "Run the Detector" CTA on the landing page | `src/screens/Landing.tsx` |
| `voice_enrollment_started` | User clicks "Record voice" to begin enrollment | `src/screens/EnrollScreen.tsx` |
| `voice_enrollment_completed` | Voice profile successfully built | `src/screens/EnrollScreen.tsx` |
| `voice_enrollment_failed` | Enrollment rejected — insufficient speech captured | `src/screens/EnrollScreen.tsx` |
| `session_started` | Both voices enrolled; user starts the live detector | `src/screens/EnrollScreen.tsx` |
| `session_ended` | User clicks "End session"; duration and scores captured | `src/screens/LiveScreen.tsx` |
| `summary_viewed` | Summary screen shown after session ends | `src/screens/LiveScreen.tsx` |
| `transcript_downloaded` | User downloads the .txt transcript | `src/screens/Summary.tsx` |
| `audio_downloaded` | User downloads the audio recording | `src/screens/Summary.tsx` |
| `new_session_started` | User clicks "NEW" to start over | `src/screens/Summary.tsx` |
| `judge_called` | Server: Layer 2 AI judge graded a transcript segment | `server/src/index.ts` |
| `judge_failed` | Server: Layer 2 judge threw an error | `server/src/index.ts` |
| `analyze_called` | Server: full post-session analysis completed | `server/src/index.ts` |
| `analyze_failed` | Server: post-session analysis threw an error | `server/src/index.ts` |
| `aai_token_issued` | Server: AssemblyAI streaming token successfully minted | `server/src/index.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/468179/dashboard/1707044)
- [Detector funnel: Launch → Enroll → Session](https://us.posthog.com/project/468179/insights/USw7Bv5U)
- [Daily active users](https://us.posthog.com/project/468179/insights/5tqa3yeZ)
- [Voice enrollment success rate](https://us.posthog.com/project/468179/insights/JcF7osDU)
- [AI judge calls over time](https://us.posthog.com/project/468179/insights/ZhKb7OZw)
- [Summary engagement actions](https://us.posthog.com/project/468179/insights/Wr06Xupx)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
