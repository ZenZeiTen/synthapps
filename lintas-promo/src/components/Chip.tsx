import React from "react";
import { Audio } from "@remotion/media";
import { interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT, prog } from "../theme";
import { Icon } from "./Icon";

export const Sfx: React.FC<{
  name: "whoosh" | "switch" | "ding" | "page-turn" | "mouse-click";
  at: number;
  volume?: number;
}> = ({ name, at, volume = 0.25 }) => (
  <Audio src={staticFile(`sfx/${name}.wav`)} from={at} volume={volume} />
);

export const Chip: React.FC<{
  icon: string;
  text: string;
  at: number;
  sound?: boolean;
}> = ({ icon, text, at, sound = true }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, 22);
  const flash = interpolate(frame, [at, at + 6, at + 26], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        opacity: p,
        translate: `${(1 - p) * -70}px 0px`,
        scale: String(0.94 + 0.06 * p),
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 22,
        maxWidth: 840,
        padding: "14px 32px 14px 14px",
        borderRadius: 30,
        background:
          "linear-gradient(135deg, rgba(20,52,54,0.92), rgba(11,28,30,0.92))",
        border: `2px solid rgba(79,216,200,${0.3 + 0.5 * flash})`,
        boxShadow: `0 18px 40px rgba(0,0,0,0.4), 0 0 ${
          10 + 50 * flash
        }px rgba(79,216,200,${0.15 + 0.4 * flash})`,
        fontFamily: FONT,
        fontSize: 44,
        fontWeight: 600,
        lineHeight: 1.12,
        color: C.paper,
        letterSpacing: -0.5,
      }}
    >
      {sound ? <Sfx name="mouse-click" at={at} volume={0.25} /> : null}
      <div
        style={{
          width: 68,
          height: 68,
          borderRadius: 20,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(160deg, ${C.teal}, ${C.deep})`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
        }}
      >
        <Icon name={icon} size={38} color="#fff" />
      </div>
      <span>{text}</span>
    </div>
  );
};

export const ChipColumn: React.FC<{ children: React.ReactNode; top?: number }> = ({
  children,
  top = 0,
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 18,
      marginTop: top,
    }}
  >
    {children}
  </div>
);

/** Kinetic headline: words rise in one after another. */
export const Headline: React.FC<{
  text: string;
  start?: number;
  accent?: number[];
  size?: number;
}> = ({ text, start = 4, accent = [], size = 96 }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.04,
        letterSpacing: -3,
        color: C.paper,
        display: "flex",
        flexWrap: "wrap",
        columnGap: size * 0.26,
      }}
    >
      {words.map((w, i) => {
        const p = prog(frame, start + i * 4, 22);
        const isAccent = accent.includes(i);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p,
              translate: `0px ${(1 - p) * 50}px`,
              filter: `blur(${(1 - p) * 10}px)`,
              ...(isAccent
                ? {
                    background: `linear-gradient(90deg, ${C.jade}, ${C.glow})`,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }
                : {}),
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};
