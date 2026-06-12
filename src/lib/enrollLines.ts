// Scripted enrollment lines — each person reads theirs aloud so we can build
// a voice profile before the main conversation starts.

export type EnrollLine = {
  label: string;
  line: string;
};

export const ENROLL_LINES: [EnrollLine, EnrollLine] = [
  {
    label: "Person A reads",
    line: "Hello — I'm Person A. This summer I'm interning at a fintech startup in San Francisco.",
  },
  {
    label: "Person B reads",
    line: "Hello — I'm Person B. I'm building a side project and applying to Y Combinator.",
  },
];
