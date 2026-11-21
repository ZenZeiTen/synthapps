import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Sfx } from "../components/Chip";
import { Icon } from "../components/Icon";
import { Img, staticFile } from "remotion";
import { C, FONT, prog } from "../theme";

const BADGES = [
  { icon: "box", text: "Every tab sandboxed", at: 40 },
  { icon: "key", text: "API key encrypted by your OS", at: 70 },
  { icon: "eyeoff", text: "Private tabs never reach the AI", at: 100 },
  { icon: "code", text: "Open source · MIT", at: 130 },
];

export const S8Secure: React.FC = () => {
  const frame = useCurrentFrame();
  const head = prog(frame, 6, 30);
  const bgZoom = interpolate(frame, [0, 240], [1.04, 1.12]);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ opacity: 0.4, scale: String(bgZoom), filter: "blur(10px) saturate(0.8)" }}>
        <Img src={staticFile("shots/private.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "rgba(11,20,22,0.55)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 110,
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: -4,
          color: C.paper,
          opacity: head,
          translate: `0px ${(1 - head) * 40}px`,
        }}
      >
        Secure by <span style={{ color: C.jade2 }}>design.</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 340,
          width: 1640,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 40,
        }}
      >
        {BADGES.map((b) => {
          const p = prog(frame, b.at, 24);
          return (
            <div
              key={b.text}
              style={{
                height: 250,
                display: "flex",
                alignItems: "center",
                gap: 34,
                padding: "0 44px",
                borderRadius: 36,
                background: "linear-gradient(135deg, rgba(20,52,54,0.92), rgba(11,28,30,0.92))",
                border: `2px solid rgba(79,216,200,${0.25 + 0.3 * (1 - p)})`,
                boxShadow: "0 30px 70px rgba(0,0,0,0.5)",
                opacity: p,
                translate: `0px ${(1 - p) * 70}px`,
                scale: String(0.92 + 0.08 * p),
                fontFamily: FONT,
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -1,
                color: C.paper,
              }}
            >
              <Sfx name="switch" at={b.at} volume={0.22} />
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 34,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `linear-gradient(160deg, ${C.teal}, ${C.deep})`,
                  boxShadow: `0 0 ${40 * (1 - p) + 10}px ${C.jade2}`,
                }}
              >
                <Icon name={b.icon} size={64} />
              </div>
              <span>{b.text}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
