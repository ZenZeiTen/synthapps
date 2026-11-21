import React from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Chip, ChipColumn, Headline } from "../components/Chip";
import { Ring, Stage, StageItem } from "../components/Shot";

const items: StageItem[] = [
  { src: "newtab", ar: 1.6, start: 20, end: 125, zoom: [1, 1.08], fx: [0.5, 0.5], fy: [0.5, 0.45] },
  { src: "omnibox", ar: 1.6, start: 110, end: 215, zoom: [1.0, 1.2], fx: [0.5, 0.5], fy: [0.25, 0.2] },
  {
    src: "trackers",
    ar: 1.6,
    start: 200,
    end: 290,
    zoom: [1.2, 3.2],
    fx: [0.6, 0.82],
    fy: [0.2, 0.07],
    overlay: <Ring x={81.5} y={6.9} size={64} at={235} />,
  },
  {
    src: "offline",
    ar: 1.6,
    start: 275,
    end: 400,
    zoom: [1.5, 1.9],
    fx: [0.5, 0.5],
    fy: [0.55, 0.62],
    overlay: <Ring x={32.5} y={56.5} size={0} wPct={35} hPct={7.2} at={305} />,
  },
];

export const S3Browse: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <div style={{ position: "absolute", left: 96, top: 120, width: 820 }}>
      <Headline text="Fast. Private. Works offline." accent={[3]} />
      <ChipColumn top={44}>
        <Chip icon="lock" text="HTTPS first" at={118} />
        <Chip icon="shield" text="Blocks trackers and ads" at={208} />
        <Chip icon="offline" text="Pages saved for offline reading" at={288} />
      </ChipColumn>
    </div>
    <Stage items={items} boxW={884} boxH={553} left={960} top={265} />
  </AbsoluteFill>
);
