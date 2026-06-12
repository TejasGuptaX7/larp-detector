// Scripted enrollment passages — each person reads theirs aloud so we can build
// a voice profile before the main conversation starts. They're a few sentences
// long and phonetically varied on purpose: the more diverse the vowels and
// consonants we hear, the richer and more separable each voice fingerprint.

export type EnrollLine = {
  label: string;
  line: string;
};

export const ENROLL_LINES: [EnrollLine, EnrollLine] = [
  {
    label: "Person 1 reads",
    line: "Hey, I'm the first speaker. I work on real products with real numbers, so when I talk I try to be specific about what shipped, what broke, and what I actually learned along the way.",
  },
  {
    label: "Person 2 reads",
    line: "And I'm the second speaker. I move fast, I love big ideas, and honestly I can hype a vision all day — so let's find out whose story actually holds up once the detector is listening.",
  },
];
