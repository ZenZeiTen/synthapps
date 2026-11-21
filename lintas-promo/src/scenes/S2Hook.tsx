import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Sfx } from "../components/Chip";
import { C, FONT, easeInOut, prog } from "../theme";

const WORDS = [
  { t: "Browse.", at: 3, color: C.paper },
  { t: "Translate.", at: 39, color: C.jade2 },
  { t: "Ship.", at: 75, color: C.goldHi },
];

export const S2Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Backdrop glow={1.2} />
      {WORDS.map((w, i) => {
        const next = WORDS[i + 1];
        const s = spring({ frame: frame - w.at, fps, config: { damping: 11, stiffness: 170, mass: 0.8 } });
        const out = next ? prog(frame, next.at, 14, easeInOut) : 0;
        if (frame < w.at) return null;
        const ring = prog(frame, w.at, 26);
        return (
          <AbsoluteFill key={i} style={{ alignItems: "center", justifyContent: "center" }}>
            <div
              style={{
                position: "absolute",
                width: 420,
                height: 420,
                borderRadius: "50%",
                border: `4px solid ${w.color}`,
                opacity: (1 - ring) * 0.6,
                scale: String(0.6 + ring * 2.4),
              }}
            />
            <div
              style={{
                fontFamily: FONT,
                fontWeight: 800,
                fontSize: 300,
                letterSpacing: -12,
                color: w.color,
                textShadow: `0 0 80px ${w.color}55`,
                opacity: interpolate(s, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }) * (1 - out),
                scale: String(interpolate(s, [0, 1], [1.9, 1]) * (1 - out * 0.35)),
                translate: `${-out * 420}px ${-out * 80}px`,
                filter: `blur(${(1 - Math.min(1, s)) * 14 + out * 16}px)`,
              }}
            >
              {w.t}
            </div>
          </AbsoluteFill>
        );
      })}
      <Sfx name="switch" at={3} volume={0.2} />
      <Sfx name="switch" at={39} volume={0.2} />
      <Sfx name="switch" at={75} volume={0.2} />
    </AbsoluteFill>
  );
};
