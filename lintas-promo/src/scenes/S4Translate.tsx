import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Chip, ChipColumn, Headline } from "../components/Chip";
import { AppWindow, Ring, Shot } from "../components/Shot";
import { C, FONT, prog } from "../theme";

const BW = 884;
const BH = 553;

export const S4Translate: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = prog(frame, 14, 30);
  const wipe = interpolate(frame, [92, 150], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const k = interpolate(frame, [165, 330], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const zoom = interpolate(k, [0, 1], [1.02, 2.4]);
  const fx = interpolate(k, [0, 1], [0.5, 0.87]);
  const fy = interpolate(k, [0, 1], [0.5, 0.56]);
  const idle = interpolate(frame, [30, 165], [1.0, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const z = frame < 165 ? idle : zoom;
  const px = frame < 165 ? 0.5 : fx;
  const py = frame < 165 ? 0.5 : fy;
  const tagOpacity = interpolate(frame, [40, 60, 160, 180], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tag = (label: string, x: number, active: boolean) => (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 22,
        padding: "6px 22px",
        borderRadius: 16,
        fontFamily: FONT,
        fontSize: 32,
        fontWeight: 800,
        letterSpacing: 2,
        color: active ? C.ink : C.paper,
        background: active ? C.jade2 : "rgba(11,20,22,0.8)",
        border: `2px solid ${active ? C.glow : "rgba(255,255,255,0.3)"}`,
        opacity: tagOpacity,
      }}
    >
      {label}
    </div>
  );
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 96, top: 120, width: 820 }}>
        <Headline text="Read the web in your language." accent={[4, 5]} />
        <ChipColumn top={40}>
          <Chip icon="translate" text="Translate any page in place" at={60} />
          <Chip icon="memory" text="Your translation memory first" at={185} />
          <Chip icon="book" text="Termbase enforced" at={232} />
          <Chip icon="undo" text="One click back to the original" at={282} />
        </ChipColumn>
      </div>
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 265,
          width: BW,
          height: BH,
          perspective: 2600,
          opacity: enter,
        }}
      >
        <div
          style={{
            width: BW,
            height: BH,
            transform: `translateX(${(1 - enter) * 200}px) rotateY(${
              -9 + (1 - enter) * -24 + Math.sin(frame / 55) * 1.2
            }deg) rotateX(3deg)`,
          }}
        >
          <AppWindow width={BW} height={BH}>
            <Shot src="trackers" ar={1.6} boxW={BW} boxH={BH} zoom={z} fx={px} fy={py} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                clipPath: `inset(0 ${100 - wipe}% 0 0)`,
              }}
            >
              <Shot src="translate" ar={1.6} boxW={BW} boxH={BH} zoom={z} fx={px} fy={py}>
                <Ring x={74} y={62} size={0} wPct={10.4} hPct={4.6} at={282} />
              </Shot>
            </div>
            {wipe > 0 && wipe < 100 ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${wipe}%`,
                  width: 6,
                  background: C.glow,
                  boxShadow: `0 0 40px 10px ${C.jade2}`,
                }}
              />
            ) : null}
            {tag("EN", 24, wipe < 50)}
            {tag("ID", BW - 90, wipe >= 50)}
          </AppWindow>
        </div>
      </div>
    </AbsoluteFill>
  );
};
