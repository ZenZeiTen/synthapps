import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, prog } from "../theme";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Screenshot cropped to a box. zoom is relative to "cover"; fx/fy = focus point (0..1) of the image. */
export const Shot: React.FC<{
  src: string;
  ar: number;
  boxW: number;
  boxH: number;
  zoom?: number;
  fx?: number;
  fy?: number;
  children?: React.ReactNode;
  dim?: number;
}> = ({ src, ar, boxW, boxH, zoom = 1, fx = 0.5, fy = 0.5, children, dim = 0 }) => {
  const cover = Math.max(boxW, boxH * ar);
  const imgW = cover * zoom;
  const imgH = imgW / ar;
  const left = clamp(boxW / 2 - fx * imgW, boxW - imgW, 0);
  const top = clamp(boxH / 2 - fy * imgH, boxH - imgH, 0);
  return (
    <div
      style={{
        position: "relative",
        width: boxW,
        height: boxH,
        overflow: "hidden",
        backgroundColor: "#0b1416",
      }}
    >
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: imgW,
          height: imgH,
        }}
      >
        <Img
          src={staticFile(`shots/${src}.png`)}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {children}
      </div>
      {dim > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: `rgba(0,0,0,${dim})`,
          }}
        />
      ) : null}
    </div>
  );
};

export const AppWindow: React.FC<{
  width: number;
  height: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ width, height, style, children }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 22,
      overflow: "hidden",
      position: "relative",
      boxShadow:
        "0 60px 120px rgba(0,0,0,0.6), 0 20px 40px rgba(0,0,0,0.4), 0 0 0 1.5px rgba(255,255,255,0.14), 0 0 140px rgba(60,191,154,0.2)",
      ...style,
    }}
  >
    {children}
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 22,
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 28%)",
        pointerEvents: "none",
      }}
    />
  </div>
);

/** Pulsing highlight ring placed in image-percentage coordinates. */
export const Ring: React.FC<{
  x: number;
  y: number;
  size: number;
  at: number;
  color?: string;
  wPct?: number;
  hPct?: number;
}> = ({ x, y, size, at, color = C.goldHi, wPct, hPct }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, 16);
  const pulse = 1 + 0.08 * Math.sin((frame - at) / 5);
  const rect = wPct !== undefined && hPct !== undefined;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: rect ? `${wPct}%` : size,
        height: rect ? `${hPct}%` : size,
        translate: rect ? "0 0" : "-50% -50%",
        scale: String(interpolate(p, [0, 1], [1.8, 1]) * (rect ? 1 : pulse)),
        opacity: p,
        borderRadius: rect ? 24 : "50%",
        border: `5px solid ${color}`,
        boxShadow: `0 0 40px ${color}, inset 0 0 30px ${color}55`,
      }}
    />
  );
};

export type StageItem = {
  src: string;
  ar: number;
  start: number;
  end: number;
  zoom: [number, number];
  fx: [number, number];
  fy: [number, number];
  overlay?: React.ReactNode;
};

/** A stack of cropped screenshots that fly in one after another inside an app window frame. */
export const Stage: React.FC<{
  items: StageItem[];
  boxW: number;
  boxH: number;
  left: number;
  top: number;
  ry?: number;
  rx?: number;
  fly?: number;
}> = ({ items, boxW, boxH, left, top, ry = -9, rx = 3, fly = 200 }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: boxW,
        height: boxH,
        perspective: 2600,
      }}
    >
      {items.map((it, i) => {
        if (frame < it.start - 1 || frame > it.end + 1) return null;
        const enter = prog(frame, it.start, 28);
        const exit = prog(frame, it.end - 14, 14, Easing.in(Easing.cubic));
        const k = interpolate(frame, [it.start, it.end], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.quad),
        });
        const zoom = interpolate(k, [0, 1], it.zoom);
        const fx = interpolate(k, [0, 1], it.fx);
        const fy = interpolate(k, [0, 1], it.fy);
        const drift = Math.sin(frame / 55) * 1.2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              opacity: enter * (1 - exit),
              transform: `translateX(${(1 - enter) * fly - exit * 90}px) translateY(${
                exit * -20
              }px) rotateY(${ry + (1 - enter) * -26 + exit * 10 + drift}deg) rotateX(${
                rx + (1 - enter) * 8
              }deg) scale(${0.94 + 0.06 * enter - exit * 0.04})`,
            }}
          >
            <AppWindow width={boxW} height={boxH}>
              <Shot
                src={it.src}
                ar={it.ar}
                boxW={boxW}
                boxH={boxH}
                zoom={zoom}
                fx={fx}
                fy={fy}
              >
                {it.overlay}
              </Shot>
            </AppWindow>
          </div>
        );
      })}
    </div>
  );
};
