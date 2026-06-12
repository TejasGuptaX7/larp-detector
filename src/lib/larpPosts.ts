export type LarpPost = {
  kind: "linkedin" | "twitter";
  name: string;
  handle: string;
  body: string;
  reactions: string;
  score: number;
};

// Paraphrased from the viral hall-of-fame of timeline larping.
export const LEFT_RAIL: LarpPost[] = [
  {
    kind: "linkedin",
    name: "Brayden Hustlewell",
    handle: "Keynote Speaker | Girl Dad | 2x Exited (internally)",
    body: "I turned down a $75,000 speaking gig because I pinky-promised my son we'd ride bikes on Saturday.\n\nIntegrity > income.\n\nAgree? 👇",
    reactions: "4,812 reactions · 967 comments",
    score: 97,
  },
  {
    kind: "linkedin",
    name: "Chad Founderson",
    handle: "CEO | Visionary | Crying in 4K",
    body: "I just laid off 14 incredible people.\n\nThis is the hardest post I've ever written.\n\nAnyway, here's a selfie of me crying about it.",
    reactions: "11,203 reactions · 2,431 comments",
    score: 94,
  },
  {
    kind: "linkedin",
    name: "Melissa Synergy",
    handle: "Fractional CMO | Thought Leader | Human",
    body: "My 6-year-old asked me: \"Mommy, what's churn?\"\n\nWhat happened next changed how I think about B2B SaaS forever.\n\nA thread on parenting and pipeline. 🧵",
    reactions: "3,108 reactions · 540 comments",
    score: 92,
  },
  {
    kind: "linkedin",
    name: "Dax Grindwell",
    handle: "Founder @ Stealth | Ex-Hustle | 5AM Club",
    body: "I wake up at 3:47am.\nIce bath. 10k run. Meditate. Journal.\nClose 3 enterprise deals before your alarm rings.\n\nWe are not the same.",
    reactions: "8,440 reactions · 1,112 comments",
    score: 99,
  },
  {
    kind: "linkedin",
    name: "Preston Valueworth",
    handle: "Serial Entrepreneur | Mentor to Millions",
    body: "A homeless man asked me for change.\n\nI gave him my personal MBA reading list instead.\n\nToday he runs a 7-figure dropshipping empire.\n\nNever underestimate VALUE.",
    reactions: "6,932 reactions · 3,287 comments",
    score: 98,
  },
  {
    kind: "linkedin",
    name: "Tiffany Scaleworth",
    handle: "I help founders 10x | Course launching soon",
    body: "I interviewed 400 millionaires.\n\n399 of them said the exact same thing.\n\n(What they said is in my course. I'm humbled to announce my course.)",
    reactions: "2,955 reactions · 410 comments",
    score: 95,
  },
];

export const RIGHT_RAIL: LarpPost[] = [
  {
    kind: "twitter",
    name: "zen builder",
    handle: "@shipfast_dharma",
    body: "$0 → $42k MRR in 11 days.\n\nNo code. No team. No product, actually.\n\nJust vibes. Here's the playbook: 🧵",
    reactions: "2.4K reposts · 18K likes",
    score: 98,
  },
  {
    kind: "twitter",
    name: "Kyle Capital",
    handle: "@kylecapital_eth",
    body: "Quietly closed our seed round at a number I can't share (it's big).\n\nStaying humble.\n\nBack to work.",
    reactions: "812 reposts · 9,2K likes",
    score: 91,
  },
  {
    kind: "twitter",
    name: "indie larper",
    handle: "@degen_of_one",
    body: "I don't have a degree.\n\nI have 14 SaaS products, 6-pack abs, and a Notion template that prints money.",
    reactions: "1.1K reposts · 14K likes",
    score: 96,
  },
  {
    kind: "twitter",
    name: "Mystery Macro",
    handle: "@alpha_whisperer",
    body: "Just had dinner with 3 unicorn founders. Can't say who.\n\nWhat they told me will change everything in 2025.",
    reactions: "640 reposts · 7.7K likes",
    score: 93,
  },
  {
    kind: "twitter",
    name: "Bali Ben",
    handle: "@passiveben",
    body: "My agency hit $1M while I was asleep on a beach in Bali.\n\nBuilding in public soon. Maybe.",
    reactions: "977 reposts · 11K likes",
    score: 95,
  },
  {
    kind: "twitter",
    name: "agent maxi",
    handle: "@post_agi_sales",
    body: "Everyone's hiring engineers.\n\nI replaced my whole team with 7 AI agents and a dream.\n\nRevenue is theoretical but morale is infinite.",
    reactions: "1.8K reposts · 21K likes",
    score: 97,
  },
];
