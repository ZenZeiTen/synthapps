import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Sfx } from "../components/Chip";
import { C, FONT, prog } from "../theme";

export const S9Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame: frame - 34, fps, config: { damping: 12, stiffness: 120 } });
  const flash = interpolate(frame, [40, 46, 70], [0, 0.7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const word = prog(frame, 52, 26);
  const l1 = prog(frame, 76, 26);
  const l2 = prog(frame, 92, 26);
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Backdrop glow={1.2} />
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
            width: 300,
            height: 300,
            borderRadius: 84,
            overflow: "hidden",
            opacity: Math.min(1, s * 2),
            transform: `rotateY(${(1 - s) * 50}deg) scale(${0.4 + 0.6 * s})`,
            boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 ${60 + flash * 200}px rgba(79,216,200,${
              0.5 + flash
            })`,
          }}
        >
          <Img src={staticFile("icon.png")} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 470,
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 190,
          fontWeight: 800,
          letterSpacing: -7,
          color: C.paper,
          opacity: word,
          translate: `0px ${(1 - word) * 40}px`,
        }}
      >
        Lintas
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 700,
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 64,
          fontWeight: 600,
          color: C.paper,
          opacity: l1,
          translate: `0px ${(1 - l1) * 30}px`,
        }}
      >
        Free for Windows · Version 0.5.1
      </div>
      {/* The maker: a thin gold rule, then the Nusalexia name */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 832,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          opacity: l2,
          translate: `0px ${(1 - l2) * 24}px`,
        }}
      >
        <div
          style={{
            width: interpolate(l2, [0, 1], [0, 220]),
            height: 2,
            background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`,
          }}
        />
        <div
          style={{
            fontFamily: FONT,
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: 12,
            textTransform: "uppercase",
            color: C.gold,
          }}
        >
          A Nusalexia product
        </div>
      </div>
      <Sfx name="ding" at={40} volume={0.6} />
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
