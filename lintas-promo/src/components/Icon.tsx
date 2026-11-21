import React from "react";

const P: Record<string, string[]> = {
  shield: ["M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z", "M9 12l2 2 4-4"],
  lock: ["M5 11h14v9H5z", "M8 11V8a4 4 0 018 0v3"],
  offline: [
    "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z",
    "M14 3v5h5",
    "M12 11v5m0 0l-2-2m2 2l2-2",
  ],
  translate: [
    "M4 5h9M8.5 3v2M6 5c.5 4 3 7 6 8M12 5c-.5 4-3 7-7 9",
    "M12 20l4.5-10L21 20M13.5 17h6",
  ],
  memory: [
    "M5 6a7 3 0 1 0 14 0a7 3 0 1 0 -14 0",
    "M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6",
    "M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6",
  ],
  book: ["M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z", "M5 17a3 3 0 013-3h11"],
  undo: ["M9 14L4 9l5-5", "M4 9h10a6 6 0 010 12h-3"],
  grid: ["M3 3h8v8H3z", "M13 3h8v8h-8z", "M3 13h8v8H3z", "M13 13h8v8h-8z"],
  pencil: ["M4 20l4-1 11-11-3-3L5 16z", "M14 6l3 3"],
  qa: [
    "M9 4h6v3H9z",
    "M7 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1",
    "M9 14l2 2 4-4",
  ],
  sparkle: [
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    "M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  ],
  puzzle: [
    "M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v6h-6v-2a2 2 0 10-4 0v2H4v-6h2a2 2 0 100-4H4V6h6z",
  ],
  panel: ["M3 5h18v14H3z", "M15 5v14"],
  plug: ["M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0z", "M12 17v4"],
  key: [
    "M4 15a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
    "M11 12l9-9M16 7l3 3",
  ],
  eyeoff: [
    "M3 3l18 18",
    "M10.6 5.1A10 10 0 0112 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.5 6.6C4.3 8 2.7 10.3 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1",
    "M9.9 9.9a3 3 0 004.2 4.2",
  ],
  box: [
    "M12 3l8 4.5v9L12 21l-8-4.5v-9z",
    "M12 12l8-4.5M12 12v9M12 12L4 7.5",
  ],
  code: ["M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"],
  search: ["M5 11a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M20 20l-4.2-4.2"],
  compass: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M15.5 8.5l-2 5-5 2 2-5z",
  ],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  check: ["M5 12.5l4.5 4.5L19 7"],
};

export const Icon: React.FC<{
  name: keyof typeof P | string;
  size?: number;
  color?: string;
  stroke?: number;
}> = ({ name, size = 40, color = "#fff", stroke = 1.8 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: "block", flexShrink: 0 }}
  >
    {(P[name] ?? []).map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);
