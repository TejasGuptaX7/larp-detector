import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LarpPostCard } from "../components/LarpPostCard";
import { InterviewScene } from "../components/InterviewScene";
import { LEFT_RAIL, RIGHT_RAIL } from "../lib/larpPosts";
import "../landing.css";

gsap.registerPlugin(ScrollTrigger);

type Props = { onLaunch: () => void };

function SplitWord({ text }: { text: string }) {
  return (
    <span className="split-line" aria-label={text}>
      {text.split("").map((c, i) => (
        <span className="ch" key={i} aria-hidden>
          {c === " " ? "\u00A0" : c}
        </span>
      ))}
    </span>
  );
}

const TICKER_PHRASES = [
  "HUMBLED TO ANNOUNCE",
  "WE'RE CRUSHING IT",
  "10X OPERATOR",
  "STEALTH MODE",
  "SERIAL VISIONARY",
  "MY MENTOR ELON",
  "PRE-REVENUE UNICORN",
  "THOUGHT LEADER",
  "GRINDSET",
  "EXITED (EMOTIONALLY)",
];

export function Landing({ onLaunch }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    document.documentElement.classList.add("lp-mode");
    window.scrollTo(0, 0);

    const ctx = gsap.context(() => {
      /* ---------- hero entrance ---------- */
      const intro = gsap.timeline({ defaults: { ease: "power4.out" } });
      intro
        .from(".hero-label", { y: 24, autoAlpha: 0, duration: 0.7 }, 0.1)
        .from(
          ".hero h1 .ch",
          { yPercent: 118, duration: 1.1, stagger: 0.028 },
          0.2,
        )
        .from(".hero-sub", { y: 28, autoAlpha: 0, duration: 0.8 }, "-=0.55")
        .from(".hero-ctas", { y: 24, autoAlpha: 0, duration: 0.7 }, "-=0.5")
        .from(".hero-meta", { autoAlpha: 0, duration: 0.8 }, "-=0.4");

      // forensic scanline sweeping the hero forever
      gsap.fromTo(
        ".hero-scan",
        { top: "-4%" },
        { top: "104%", duration: 5.5, ease: "none", repeat: -1 },
      );

      // blinking REC dot
      gsap.to(".hero-rec i", {
        opacity: 0.15,
        duration: 0.7,
        repeat: -1,
        yoyo: true,
        ease: "power1.inOut",
      });

      // buzzword ticker
      gsap.to(".ticker-track", {
        xPercent: -50,
        duration: 26,
        ease: "none",
        repeat: -1,
      });

      /* ---------- evidence rails ---------- */
      gsap.fromTo(
        ".rail--left .rail-track",
        { yPercent: 0 },
        {
          yPercent: -32,
          ease: "none",
          scrollTrigger: {
            trigger: ".evidence",
            start: "top bottom",
            end: "bottom top",
            scrub: 0.8,
          },
        },
      );
      gsap.fromTo(
        ".rail--right .rail-track",
        { yPercent: -32 },
        {
          yPercent: 0,
          ease: "none",
          scrollTrigger: {
            trigger: ".evidence",
            start: "top bottom",
            end: "bottom top",
            scrub: 0.8,
          },
        },
      );

      // verdict stamps slam in per card
      gsap.utils.toArray<HTMLElement>(".evidence .post-stamp").forEach((el) => {
        gsap.from(el, {
          scale: 2.6,
          autoAlpha: 0,
          rotation: 18,
          duration: 0.45,
          ease: "power3.in",
          scrollTrigger: {
            trigger: el,
            start: "top 78%",
            toggleActions: "play none none reverse",
          },
        });
      });

      // center statement reveal
      gsap.from(".ev-center .ev-line", {
        yPercent: 110,
        stagger: 0.12,
        duration: 0.9,
        ease: "power4.out",
        scrollTrigger: {
          trigger: ".evidence",
          start: "top 55%",
          toggleActions: "play none none reverse",
        },
      });

      /* ---------- interview scene (pinned + scrubbed) ---------- */
      const meterNum = root.current!.querySelector(
        ".iv-meter-num",
      ) as HTMLElement;
      const meterFill = root.current!.querySelector(
        ".iv-meter-fill",
      ) as HTMLElement;
      const syncMeterNum = () => {
        const s = Number(gsap.getProperty(meterFill, "scaleX"));
        meterNum.textContent = String(Math.round(s * 100)).padStart(2, "0");
      };

      const iv = gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: {
          trigger: ".interview",
          start: "top top",
          end: "+=3200",
          scrub: 0.6,
          pin: true,
          anticipatePin: 1,
        },
      });

      const bubbleIn = (sel: string) =>
        iv
          .fromTo(
            sel,
            { scale: 0.7, autoAlpha: 0, y: 16 },
            { scale: 1, autoAlpha: 1, y: 0, duration: 0.5 },
          )
          .to({}, { duration: 0.7 }); // hold
      const bubbleOut = (sel: string) =>
        iv.to(sel, { autoAlpha: 0, y: -12, duration: 0.3 });

      iv.from(".iv-title .ch", {
        yPercent: 115,
        stagger: 0.03,
        duration: 0.6,
        ease: "power4.out",
      })
        .from(".iv-interviewer", { x: -110, autoAlpha: 0, duration: 0.7 }, "<")
        .from(".iv-candidate", { x: 110, autoAlpha: 0, duration: 0.7 }, "<")
        .from(".iv-meter", { y: -28, autoAlpha: 0, duration: 0.5 }, "-=0.3");

      bubbleIn(".iv-b1");
      bubbleOut(".iv-b1");

      bubbleIn(".iv-b2");
      iv.to(
        ".iv-meter-fill",
        { scaleX: 0.34, duration: 0.5, onUpdate: syncMeterNum },
        "<",
      );
      iv.to(
        ".iv-nose",
        { scaleX: 1.9, transformOrigin: "right center", duration: 0.5, ease: "power2.in" },
        "<",
      );
      iv.to(".iv-arm", { rotation: -16, transformOrigin: "right center", duration: 0.4 }, "<");
      bubbleOut(".iv-b2");

      bubbleIn(".iv-b3");
      iv.to(".iv-head-l", { rotation: -7, transformOrigin: "center", duration: 0.4 }, "<");
      bubbleOut(".iv-b3");

      bubbleIn(".iv-b4");
      iv.to(
        ".iv-meter-fill",
        { scaleX: 0.67, duration: 0.5, onUpdate: syncMeterNum },
        "<",
      );
      iv.to(
        ".iv-nose",
        { scaleX: 3.1, transformOrigin: "right center", duration: 0.5, ease: "power2.in" },
        "<",
      );
      iv.to(".iv-sweat", { autoAlpha: 1, y: 4, duration: 0.4 }, "<");
      bubbleOut(".iv-b4");

      bubbleIn(".iv-b5");
      iv.to(
        ".iv-meter-fill",
        { scaleX: 0.98, duration: 0.5, onUpdate: syncMeterNum },
        "<",
      );
      iv.to(".iv-meter", { color: "#ff3b3b", duration: 0.3 }, "<");
      iv.to(
        ".iv-nose",
        { scaleX: 4.6, transformOrigin: "right center", duration: 0.5, ease: "power2.in" },
        "<",
      );

      iv.to(".iv-flash", { autoAlpha: 0.55, duration: 0.12, ease: "none" })
        .to(".iv-flash", { autoAlpha: 0, duration: 0.25, ease: "none" })
        .fromTo(
          ".iv-stamp",
          { xPercent: -50, scale: 3.4, autoAlpha: 0, rotation: -22 },
          {
            xPercent: -50,
            scale: 1,
            autoAlpha: 1,
            rotation: -12,
            duration: 0.45,
            ease: "power4.in",
          },
        )
        .to({}, { duration: 0.8 }); // hold the verdict

      /* ---------- how it works ---------- */
      gsap.utils.toArray<HTMLElement>(".how-row").forEach((row) => {
        gsap.from(row.querySelectorAll(".how-num, .how-word, .how-copy"), {
          y: 54,
          autoAlpha: 0,
          duration: 0.8,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: row,
            start: "top 74%",
            toggleActions: "play none none reverse",
          },
        });
      });

      /* ---------- final CTA ---------- */
      gsap.from(".cta-word--1", {
        xPercent: -46,
        ease: "none",
        scrollTrigger: {
          trigger: ".cta",
          start: "top bottom",
          end: "top 12%",
          scrub: 0.7,
        },
      });
      gsap.from(".cta-word--2", {
        xPercent: 46,
        ease: "none",
        scrollTrigger: {
          trigger: ".cta",
          start: "top bottom",
          end: "top 12%",
          scrub: 0.7,
        },
      });
      gsap.from(".cta-action", {
        y: 36,
        autoAlpha: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".cta",
          start: "top 30%",
          toggleActions: "play none none reverse",
        },
      });

      // nav shade after hero
      gsap.to(".lp-nav", {
        backgroundColor: "rgba(10,10,10,0.86)",
        backdropFilter: "blur(12px)",
        duration: 0.3,
        scrollTrigger: {
          trigger: ".hero",
          start: "bottom 90%",
          toggleActions: "play none none reverse",
        },
      });
    }, root);

    return () => {
      ctx.revert();
      document.documentElement.classList.remove("lp-mode");
    };
  }, []);

  return (
    <div className="lp" ref={root}>
      {/* ---------- nav ---------- */}
      <nav className="lp-nav">
        <span className="lp-mark">
          STOP&nbsp;LARPING<i className="lp-mark-dot" />
        </span>
        <button className="lp-nav-btn" onClick={onLaunch}>
          RUN DETECTOR
        </button>
      </nav>

      {/* ---------- hero ---------- */}
      <header className="hero">
        <div className="hero-scan" />
        <p className="hero-label">LARP DETECTION SYSTEM — V1.0</p>
        <h1>
          <span className="mask">
            <SplitWord text="STOP" />
          </span>
          <span className="mask mask--accent">
            <SplitWord text="LARPING" />
          </span>
        </h1>
        <p className="hero-sub">
          A realtime larp detector. Point it at anyone making claims —
          founders, candidates, your timeline — and get a verdict.
        </p>
        <div className="hero-ctas">
          <button className="btn btn--primary" onClick={onLaunch}>
            RUN THE DETECTOR
          </button>
          <a className="btn btn--ghost" href="#evidence">
            SEE THE EVIDENCE
          </a>
        </div>
        <div className="hero-meta">
          <span className="hero-rec">
            <i /> LIVE ANALYSIS
          </span>
          <span className="hero-scroll">SCROLL TO INVESTIGATE ↓</span>
        </div>
      </header>

      {/* ---------- buzzword ticker ---------- */}
      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[...TICKER_PHRASES, ...TICKER_PHRASES].map((p, i) => (
            <span key={i}>
              {p} <em>✕</em>
            </span>
          ))}
        </div>
      </div>

      {/* ---------- evidence rails ---------- */}
      <section className="evidence" id="evidence">
        <div className="rail rail--left" aria-hidden>
          <div className="rail-track">
            {[...LEFT_RAIL, ...LEFT_RAIL].map((p, i) => (
              <LarpPostCard post={p} key={i} />
            ))}
          </div>
        </div>

        <div className="ev-center">
          <p className="ev-kicker">EXHIBIT A — THE FEED</p>
          <h2>
            <span className="mask">
              <span className="ev-line">YOUR TIMELINE</span>
            </span>
            <span className="mask">
              <span className="ev-line">
                IS <b>87%</b> LARP
              </span>
            </span>
          </h2>
          <p className="ev-copy">
            Pinky promises. Crying CEOs. $42k MRR in eleven days. Somebody has
            to say it: they are role‑playing. We built the instrument that
            proves it.
          </p>
        </div>

        <div className="rail rail--right" aria-hidden>
          <div className="rail-track">
            {[...RIGHT_RAIL, ...RIGHT_RAIL].map((p, i) => (
              <LarpPostCard post={p} key={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- interview scene ---------- */}
      <section className="interview">
        <p className="iv-kicker">EXHIBIT B — THE INTERVIEW</p>
        <h2 className="iv-title">
          <span className="mask">
            <SplitWord text="WATCH IT WORK" />
          </span>
        </h2>
        <InterviewScene />
      </section>

      {/* ---------- how it works ---------- */}
      <section className="how">
        <p className="how-kicker">PROTOCOL</p>
        <div className="how-row">
          <span className="how-num">01</span>
          <span className="how-word">LISTEN</span>
          <p className="how-copy">
            The mic stays open. Every claim is transcribed in realtime, word
            by suspicious word.
          </p>
        </div>
        <div className="how-row">
          <span className="how-num">02</span>
          <span className="how-word">JUDGE</span>
          <p className="how-copy">
            A merciless model cross‑examines each statement for buzzwords,
            vagueness and unverifiable glory.
          </p>
        </div>
        <div className="how-row">
          <span className="how-num">03</span>
          <span className="how-word">VERDICT</span>
          <p className="how-copy">
            A live 0–100 larp score, per speaker. No appeals process. The
            gauge does not negotiate.
          </p>
        </div>
      </section>

      {/* ---------- final CTA ---------- */}
      <section className="cta">
        <h2>
          <span className="cta-word cta-word--1">STOP</span>
          <span className="cta-word cta-word--2">LARPING<i>.</i></span>
        </h2>
        <div className="cta-action">
          <button className="btn btn--primary btn--xl" onClick={onLaunch}>
            RUN THE DETECTOR
          </button>
          <p>Free to run. Costly to your friends’ egos.</p>
        </div>
      </section>

      <footer className="lp-foot">
        <span>STOP LARPING © {new Date().getFullYear()}</span>
        <span>ALL CLAIMS ON THIS PAGE WERE VERIFIED. UNLIKE YOURS.</span>
      </footer>
    </div>
  );
}
