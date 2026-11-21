import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { C, FONT, prog } from "../theme";

export const S1Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bloom = prog(frame, 0, 50);
  const s = spring({ frame: frame - 22, fps, config: { damping: 13, stiffness: 90, mass: 1 } });
  const ry = interpolate(s, [0, 1], [-75, 0]);
  const rx = interpolate(s, [0, 1], [24, 0]);
  const sweep = interpolate(frame, [62, 100], [-140, 140], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const floatY = Math.sin(frame / 30) * 6;
  const letters = "Lintas".split("");
  const tag = prog(frame, 122, 30);
  const fadeIn = prog(frame, 0, 20);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: bloom }}>
        <Backdrop glow={0.6 + bloom * 0.9} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: bloom * 0.9,
          background:
            "radial-gradient(600px 600px at 50% 36%, rgba(79,216,200,0.45), transparent 70%)",
          scale: String(0.6 + 0.4 * bloom),
        }}
      />
      <AbsoluteFill style={{ opacity: fadeIn }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 150,
            display: "flex",
            justifyContent: "center",
            perspective: 1400,
          }}
        >
          <div
            style={{
              width: 280,
              height: 280,
              borderRadius: 78,
              overflow: "hidden",
              position: "relative",
              opacity: Math.min(1, s * 1.5),
              transform: `translateY(${floatY}px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${
                0.25 + 0.75 * s
              })`,
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.6), 0 0 140px rgba(14,140,134,0.7)",
            }}
          >
            <Img src={staticFile("icon.png")} style={{ width: "100%", height: "100%" }} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.8) 50%, transparent 62%)",
                translate: `${sweep}% 0%`,
                mixBlendMode: "overlay",
              }}
            />
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 490,
            display: "flex",
            justifyContent: "center",
            fontFamily: FONT,
            fontSize: 170,
            fontWeight: 800,
            letterSpacing: -6,
            color: C.paper,
          }}
        >
          {letters.map((l, i) => {
            const p = prog(frame, 70 + i * 4, 16);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: p,
                  translate: `0px ${(1 - p) * 60}px`,
                  filter: `blur(${(1 - p) * 14}px)`,
                }}
              >
                {l}
              </span>
            );
          })}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 745,
            textAlign: "center",
            fontFamily: FONT,
            fontSize: 64,
            fontWeight: 500,
            color: "rgba(242,245,247,0.92)",
            opacity: tag,
            translate: `0px ${(1 - tag) * 30}px`,
            letterSpacing: -1,
          }}
        >
          The browser built for{" "}
          <span style={{ color: C.jade2, fontWeight: 700 }}>translators.</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
