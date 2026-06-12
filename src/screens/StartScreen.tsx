type Props = { onStart: () => void };

export function StartScreen({ onStart }: Props) {
  return (
    <div className="start">
      <div className="start-mark">L A R P</div>

      <div className="start-hero">
        <div className="num">0%</div>
        <div className="start-word">Detector</div>
      </div>

      <div className="start-seats">
        <div className="seat-pick">
          <span>A</span>
          <span className="seat-dot" style={{ background: "var(--low)" }} />
        </div>
        <div className="seat-pick">
          <span>B</span>
          <span className="seat-dot" style={{ background: "var(--high)" }} />
        </div>
      </div>

      <button className="btn-start" onClick={onStart}>
        Go Live
      </button>
    </div>
  );
}
