import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Chip, ChipColumn, Headline, Sfx } from "../components/Chip";
import { AppWindow, Shot, Stage, StageItem } from "../components/Shot";
import { lerp, prog } from "../theme";

const WW = 700;
const WH = 438;
const SHOTS = [
  { src: "tms-home", ar: 1.6, a: 100, b: 165 },
  { src: "tms-project", ar: 1.6, a: 165, b: 232 },
  { src: "cat-editor", ar: 1.6, a: 232, b: 300 },
  { src: "qa", ar: 1.6, a: 300, b: 352 },
];

const final: StageItem[] = [
  { src: "editor-ai", ar: 1.6, start: 345, end: 410, zoom: [1.0, 1.12], fx: [0.5, 0.7], fy: [0.5, 0.5] },
  { src: "pretranslate", ar: 1.6, start: 395, end: 470, zoom: [1.0, 1.1], fx: [0.5, 0.5], fy: [0.5, 0.45] },
];

export const S5Tms: React.FC = () => {
  const frame = useCurrentFrame();
  const spread = prog(frame, 12, 60);
  const stackOut = prog(frame, 335, 20, Easing.in(Easing.cubic));
  const stackIn = prog(frame, 0, 26);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 96, top: 110, width: 840 }}>
        <Headline text="Your TMS lives in your browser." accent={[1, 5]} />
        <ChipColumn top={34}>
          <Chip icon="grid" text="A full Translation Management System, built in" at={108} />
          <Chip icon="pencil" text="CAT editor with fuzzy TM matches" at={238} />
          <Chip icon="qa" text="QA checks numbers, tags and terms" at={306} />
          <Chip icon="sparkle" text="AI pre-translation and review with your own Claude key" at={352} />
        </ChipColumn>
      </div>
      <Sfx name="page-turn" at={100} volume={0.25} />
      <Sfx name="page-turn" at={232} volume={0.25} />
      {frame < 360 ? (
        <div
          style={{
            position: "absolute",
            left: 960,
            top: 190,
            width: 864,
            height: 700,
            perspective: 2200,
            opacity: stackIn * (1 - stackOut),
            translate: `${-stackOut * 200}px 0px`,
          }}
        >
          {SHOTS.map((s, i) => {
            // fan pose (front window i=0)
            const fanX = (i - 1.5) * 46 * spread + (1 - spread) * 0;
            const fanY = (i - 1.5) * -70 * spread;
            const fanZ = -i * 170 * spread;
            const fanRy = -24 * spread;
            const fanRx = 6 * spread;
            const w = interpolate(frame, [s.a, s.a + 20, s.b - 8, s.b + 6], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.inOut(Easing.cubic),
            });
            const x = lerp(fanX, 40, w);
            const y = lerp(fanY, 0, w);
            const z = lerp(fanZ, 160, w);
            const ry = lerp(fanRy, -7, w);
            const rx = lerp(fanRx, 2, w);
            const active = frame >= s.a && frame < s.b + 6;
            const dim = frame >= 100 && !active ? 0.45 : 0;
            const intro = prog(frame, 4 + i * 5, 30);
            return (
              <div
                key={s.src}
                style={{
                  position: "absolute",
                  left: 80,
                  top: 130 + 0,
                  zIndex: active ? 20 : 10 - i,
                  opacity: intro,
                  transform: `translate3d(${x}px, ${y + (1 - intro) * 80}px, ${z}px) rotateY(${
                    ry + Math.sin(frame / 50 + i) * 1.2
                  }deg) rotateX(${rx}deg)`,
                }}
              >
                <AppWindow width={WW} height={WH}>
                  <Shot src={s.src} ar={s.ar} boxW={WW} boxH={WH} dim={dim} />
                </AppWindow>
              </div>
            );
          })}
        </div>
      ) : null}
      <Stage items={final} boxW={884} boxH={553} left={960} top={265} />
    </AbsoluteFill>
  );
};
