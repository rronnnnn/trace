/** Thin-stroke icon set drawn for TRACE. 18px grid, 1.4 stroke. */
type P = React.SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const IconToday = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" />
    <path d="M2.5 7h13M6 2v3M12 2v3" />
  </svg>
);
export const IconTrain = (p: P) => (
  <svg {...base(p)}>
    <path d="M1.5 9h15M4 6v6M14 6v6M2 7.5v3M16 7.5v3" />
  </svg>
);
export const IconHistory = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9a6 6 0 1 0 1.8-4.3M3 3v2.5h2.5M9 6v3.2l2 1.3" />
  </svg>
);
export const IconLandscape = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 13c2-3 4-4.5 6-4.5s3 2 5 2 2.5-1 3-1.5M2 9.5C4 6 6 4 8.5 4S12 6.5 16 6" />
  </svg>
);
export const IconExercises = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 4.5h12M3 9h12M3 13.5h7" />
  </svg>
);
export const IconReflection = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 14.5V8M7 14.5V4M11 14.5V9.5M15 14.5V6.5" />
  </svg>
);
export const IconRun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11.5" cy="3.5" r="1.5" />
    <path d="M6 7.5 8.5 6l3 1.5 1.5 2.5h2.5M8.5 6 7 10.5l3 2-1 3.5M7 10.5l-2.5 4H2" />
  </svg>
);
export const IconInsights = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 15.5h13" />
    <path d="M4.5 12.5 8 8.5l2.5 2.5 5-6" />
    <path d="M12.5 5h3v3" />
  </svg>
);
export const IconAtlas = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4.2 6.5 2.5l5 1.8 4-1.6v11.1l-4 1.7-5-1.8-4 1.6Z" />
    <path d="M6.5 2.5v11.2M11.5 4.3v11.1" />
  </svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base({ width: 14, height: 14, viewBox: "0 0 14 14", ...p })}>
    <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" />
  </svg>
);
export const IconArrowLeft = (p: P) => (
  <svg {...base({ width: 14, height: 14, viewBox: "0 0 14 14", ...p })}>
    <path d="M11.5 7h-9M6 3.5 2.5 7 6 10.5" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base({ width: 14, height: 14, viewBox: "0 0 14 14", strokeWidth: 1.7, ...p })}>
    <path d="M3 7.4 5.7 10 11 4.4" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base({ width: 14, height: 14, viewBox: "0 0 14 14", ...p })}>
    <path d="M7 2.5v9M2.5 7h9" />
  </svg>
);
export const IconMore = (p: P) => (
  <svg {...base({ width: 16, height: 16, viewBox: "0 0 16 16", ...p })}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </svg>
);
export const IconSwap = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h11l-3-3M15 12H4l3 3" />
  </svg>
);
export const IconNote = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 2.5h7l3 3v10H4z" />
    <path d="M6.5 9h5M6.5 12h3.5" />
  </svg>
);
export const IconPause = (p: P) => (
  <svg {...base({ width: 14, height: 14, viewBox: "0 0 14 14", ...p })}>
    <path d="M5 3v8M9 3v8" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base({ width: 14, height: 14, viewBox: "0 0 14 14", ...p })}>
    <path d="M4.5 3 11 7l-6.5 4z" />
  </svg>
);
export const IconBarbell = (p: P) => (
  <svg {...base({ width: 28, height: 28, viewBox: "0 0 28 28", strokeWidth: 1.5, ...p })}>
    <path d="M3 14h22M7 9v10M21 9v10M4.5 11v6M23.5 11v6" />
  </svg>
);
export const IconGoal = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 16V2.5M4 3h8.5l-1.8 2.75L12.5 8.5H4" />
  </svg>
);
export const IconExpand = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 2.5h5v5M7.5 15.5h-5v-5M15.5 2.5 10 8M2.5 15.5 8 10" />
  </svg>
);
