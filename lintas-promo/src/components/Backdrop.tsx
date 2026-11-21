import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const PARTICLES = Array.from({ length: 38 }, (_, i) => ({
  x: (i * 137.508) % 100,
  y: (i * 61.803 + 17) % 100,
  s: 2 + ((i * 7) % 4),
  v: 0.012 + ((i * 13) % 9) * 0.004,
  p: i * 0.9,
  gold: i % 5 === 0,
}));

export const Backdrop: React.FC<{
  glow?: number;
  tint?: "teal" | "gold";
  dim?: number;
}> = ({ glow = 1, tint = "teal", dim = 0 }) => {
  const frame = useCurrentFrame();
  const dx = Math.sin(frame / 90) * 5;
  const dy = Math.cos(frame / 110) * 4;
  const main = tint === "teal" ? "14,140,134" : "212,175,55";
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 700px at ${22 + dx}% ${
            30 + dy
          }%, rgba(${main},${0.34 * glow}), transparent 70%), radial-gradient(1000px 800px at ${
            82 - dx
          }% ${82 - dy}%, rgba(60,191,154,${
            0.2 * glow
          }), transparent 70%), radial-gradient(700px 500px at 60% 5%, rgba(9,106,102,${
            0.25 * glow
          }), transparent 70%)`,
        }}
      />
      {PARTICLES.map((p, i) => {
        const y = (((p.y - frame * p.v) % 100) + 100) % 100;
        const tw = 0.35 + 0.35 * Math.sin(frame / 25 + p.p);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${y}%`,
              width: p.s,
              height: p.s,
              borderRadius: "50%",
              backgroundColor: p.gold ? C.goldHi : C.glow,
              opacity: tw * glow,
              boxShadow: `0 0 ${p.s * 4}px ${p.gold ? C.gold : C.jade2}`,
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{
          backgroundImage: GRAIN,
          opacity: 0.07,
          mixBlendMode: "overlay",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {dim > 0 ? (
        <AbsoluteFill style={{ backgroundColor: `rgba(11,20,22,${dim})` }} />
      ) : null}
    </AbsoluteFill>
  );
};
