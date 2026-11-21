import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Sfx } from "../components/Chip";
import { Icon } from "../components/Icon";
import { Stage, StageItem } from "../components/Shot";
import { Wisp } from "../components/Wisp";
import { C, FONT, SERIF, prog } from "../theme";

const z = (a: number, b: number): [number, number] => [a, b];
const items: StageItem[] = [
  { src: "oracle-empty", ar: 1400 / 900, start: 20, end: 125, zoom: z(1.17, 1.24), fx: z(0.8, 0.82), fy: z(0.57, 0.57) },
  { src: "oracle-running", ar: 1280 / 820, start: 110, end: 215, zoom: z(1.17, 1.24), fx: z(0.8, 0.82), fy: z(0.57, 0.57) },
  { src: "oracle-approval", ar: 1280 / 820, start: 200, end: 330, zoom: z(1.17, 1.26), fx: z(0.8, 0.82), fy: z(0.57, 0.6) },
  { src: "oracle-done", ar: 1280 / 820, start: 315, end: 520, zoom: z(1.17, 1.24), fx: z(0.8, 0.82), fy: z(0.57, 0.57) },
];

const SEALS = [
  { icon: "search", label: "Research", at: 92 },
  { icon: "compass", label: "Planning", at: 118 },
  { icon: "layers", label: "Memory", at: 144 },
  { icon: "bolt", label: "Action", at: 170 },
];

export const S6Oracle: React.FC = () => {
  const frame = useCurrentFrame();
  const title = prog(frame, 6, 30);
  const sub = prog(frame, 22, 30);
  const wispIn = prog(frame, 0, 40);
  const banner = interpolate(frame, [212, 232, 322, 336], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <Backdrop tint="gold" glow={0.9} />
      <div
        style={{
          position: "absolute",
          left: -40,
          top: 190,
          width: 960,
          height: 700,
          opacity: wispIn,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(closest-side at 50% 50%, rgba(79,216,200,0.38), rgba(60,191,154,0.12) 60%, transparent 100%)",
          }}
        />
        <Wisp width={960} height={700} scale={0.8 + 0.04 * wispIn} offsetY={-0.25} />
      </div>
      <div style={{ position: "absolute", left: 96, top: 96, width: 800 }}>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 136,
            fontWeight: 800,
            letterSpacing: -4,
            lineHeight: 1,
            background: `linear-gradient(180deg, ${C.goldHi}, ${C.gold})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            opacity: title,
            translate: `0px ${(1 - title) * 40}px`,
            filter: `drop-shadow(0 0 30px rgba(212,175,55,0.4))`,
          }}
        >
          AI Oracle
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: SERIF,
            fontSize: 52,
            fontStyle: "italic",
            color: C.paper,
            opacity: sub,
            translate: `0px ${(1 - sub) * 24}px`,
          }}
        >
          Many Minds. One Guiding Light.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 770,
          width: 900,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {SEALS.map((s) => {
          const lit = prog(frame, s.at, 14);
          const appear = prog(frame, 70, 20);
          return (
            <div
              key={s.label}
              style={{
                width: 225,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                opacity: appear,
              }}
            >
              <Sfx name="switch" at={s.at} volume={0.2} />
              <div
                style={{
                  width: 132,
                  height: 132,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `5px solid ${lit > 0.5 ? C.goldHi : "rgba(212,175,55,0.45)"}`,
                  background: `radial-gradient(circle, rgba(60,191,154,${
                    0.08 + 0.5 * lit
                  }), rgba(11,20,22,0.9) 75%)`,
                  boxShadow: `0 0 ${50 * lit}px rgba(168,255,242,${0.7 * lit}), 0 0 ${
                    30 * lit
                  }px rgba(212,175,55,${0.6 * lit})`,
                  scale: String(1 + 0.12 * Math.sin(lit * Math.PI)),
                }}
              >
                <Icon name={s.icon} size={62} color={lit > 0.5 ? C.glow : C.gold} stroke={1.7} />
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 40,
                  fontWeight: 700,
                  color: lit > 0.5 ? C.paper : "rgba(242,245,247,0.55)",
                }}
              >
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
      <Stage items={items} boxW={760} boxH={835} left={1064} top={122} ry={-6} rx={2} fly={90} />
      <div
        style={{
          position: "absolute",
          left: 800,
          top: 420,
          opacity: banner,
          translate: `${(1 - banner) * -60}px 0px`,
          padding: "22px 36px",
          borderRadius: 30,
          background: "linear-gradient(135deg, rgba(30,26,10,0.96), rgba(11,20,22,0.96))",
          border: `3px solid ${C.gold}`,
          boxShadow: `0 30px 70px rgba(0,0,0,0.6), 0 0 60px rgba(212,175,55,0.4)`,
          fontFamily: FONT,
          fontSize: 72,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -2,
          color: C.goldHi,
        }}
      >
        Asks before
        <br />
        it acts.
      </div>
    </AbsoluteFill>
  );
};
