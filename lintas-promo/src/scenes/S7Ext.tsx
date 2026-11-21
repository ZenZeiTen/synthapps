import React from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Chip, ChipColumn, Headline } from "../components/Chip";
import { Ring, Stage, StageItem } from "../components/Shot";

const items: StageItem[] = [
  { src: "extensions", ar: 1.6, start: 20, end: 130, zoom: [1.0, 1.25], fx: [0.5, 0.5], fy: [0.3, 0.3] },
  {
    src: "claude-docked",
    ar: 1400 / 900,
    start: 115,
    end: 245,
    zoom: [1.35, 1.8],
    fx: [0.6, 0.78],
    fy: [0.4, 0.45],
    overlay: <Ring x={86.2} y={6.9} size={0} wPct={3.6} hPct={5.4} at={150} />,
  },
  { src: "mcp", ar: 1.6, start: 230, end: 400, zoom: [1.6, 2.0], fx: [0.58, 0.6], fy: [0.45, 0.5] },
];

export const S7Ext: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <div style={{ position: "absolute", left: 96, top: 110, width: 840 }}>
      <Headline text="Works with the tools you already use." accent={[3, 4, 5]} />
      <ChipColumn top={44}>
        <Chip icon="puzzle" text="Chrome extensions" at={40} />
        <Chip icon="panel" text="Claude in Chrome, docked beside the page" at={135} />
        <Chip icon="plug" text="Connects to Claude Desktop (MCP)" at={250} />
      </ChipColumn>
    </div>
    <Stage items={items} boxW={884} boxH={553} left={960} top={265} />
  </AbsoluteFill>
);
