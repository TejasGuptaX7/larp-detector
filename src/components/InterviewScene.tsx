// Presentational scene. All motion is driven by GSAP timelines in Landing.tsx
// via the iv-* class hooks.
export function InterviewScene() {
  return (
    <div className="iv-stage">
      <div className="iv-meter">
        <span className="iv-meter-label">LARP PROBABILITY</span>
        <span className="iv-meter-num">00</span>
        <span className="iv-meter-track">
          <span className="iv-meter-fill" />
        </span>
      </div>

      <svg
        className="iv-svg"
        viewBox="0 0 1000 540"
        fill="none"
        aria-label="An interviewer interviewing a candidate who is larping"
      >
        {/* floor */}
        <line x1="60" y1="470" x2="940" y2="470" className="iv-floor" />

        {/* ---- interviewer (left, facing right) ---- */}
        <g className="iv-interviewer">
          {/* chair */}
          <path d="M214 470v-92h26" className="iv-line" />
          {/* legs */}
          <path d="M282 366h66v104" className="iv-fig-line" />
          {/* torso */}
          <rect x="244" y="252" width="78" height="122" rx="30" className="iv-fill-dim" />
          {/* head */}
          <g className="iv-head-l">
            <circle cx="290" cy="212" r="30" className="iv-fill-dim" />
          </g>
          {/* arm + clipboard */}
          <path d="M312 290l52 26" className="iv-fig-line" />
          <rect x="352" y="296" width="46" height="62" rx="6" className="iv-clipboard" />
          <line x1="362" y1="314" x2="388" y2="314" className="iv-clip-line" />
          <line x1="362" y1="328" x2="388" y2="328" className="iv-clip-line" />
          <line x1="362" y1="342" x2="380" y2="342" className="iv-clip-line" />
        </g>

        {/* ---- desk ---- */}
        <line x1="446" y1="470" x2="446" y2="380" className="iv-line" />
        <line x1="554" y1="470" x2="554" y2="380" className="iv-line" />
        <line x1="420" y1="380" x2="580" y2="380" className="iv-line" />

        {/* ---- candidate (right, facing left) ---- */}
        <g className="iv-candidate">
          {/* chair */}
          <path d="M786 470v-92h-26" className="iv-line" />
          {/* legs */}
          <path d="M718 366h-66v104" className="iv-fig-line" />
          {/* torso */}
          <rect x="678" y="252" width="78" height="122" rx="30" className="iv-fill-fg" />
          {/* gesturing arm */}
          <path d="M688 296l-54 18" className="iv-fig-line iv-arm" />
          {/* head + growing nose */}
          <g className="iv-head-r">
            <circle cx="710" cy="212" r="30" className="iv-fill-fg" />
            <g className="iv-nose">
              <path d="M680 208l-66 6 66 8z" className="iv-nose-path" />
            </g>
          </g>
        </g>

        {/* sweat drops, revealed late */}
        <g className="iv-sweat">
          <path d="M742 178c4 8 8 11 8 16a6 6 0 1 1-12 0c0-5 0-8 4-16z" />
          <path d="M756 196c3 6 6 9 6 13a5 5 0 1 1-10 0c0-4 1-7 4-13z" />
        </g>
      </svg>

      {/* speech bubbles */}
      <div className="iv-bubble iv-bubble--l iv-b1">
        “So… walk me through your last role.”
      </div>
      <div className="iv-bubble iv-bubble--r iv-b2">
        “I single‑handedly scaled us to 40 million users.”
      </div>
      <div className="iv-bubble iv-bubble--l iv-b3">
        “It says here the team was four interns.”
      </div>
      <div className="iv-bubble iv-bubble--r iv-b4">
        “I operate at the intersection of AI, web3 and storytelling.”
      </div>
      <div className="iv-bubble iv-bubble--r iv-b5">
        “Also — Elon follows my burner account.”
      </div>

      <div className="iv-flash" />
      <div className="iv-stamp">
        LARP
        <br />
        DETECTED
      </div>
    </div>
  );
}
