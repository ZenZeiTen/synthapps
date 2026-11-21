import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame } from "remotion";
import { C } from "../theme";

const ORBITS = Array.from({ length: 9 }, (_, i) => ({
  r: 1.45 + (i % 3) * 0.32,
  speed: 0.018 + (i % 4) * 0.006,
  phase: i * 0.7,
  tilt: i * 0.55,
  size: 0.05 + (i % 3) * 0.018,
  gold: i % 2 === 0,
}));

const DUST = Array.from({ length: 28 }, (_, i) => ({
  r: 1.2 + ((i * 37) % 100) / 60,
  a: i * 2.399,
  y: (((i * 53) % 100) / 100 - 0.5) * 2.4,
  s: 0.012 + ((i * 7) % 5) * 0.004,
}));

const WispModel: React.FC<{ scale: number; offsetY: number }> = ({
  scale,
  offsetY,
}) => {
  const frame = useCurrentFrame();
  const pulse = 1 + 0.035 * Math.sin(frame / 14);
  const emissive = 1.1 + 0.35 * Math.sin(frame / 18);
  return (
    <group position={[0, offsetY, 0]} scale={scale} rotation={[0.28, frame * 0.004, 0]}>
      <mesh scale={pulse}>
        <sphereGeometry args={[0.95, 48, 48]} />
        <meshStandardMaterial
          color="#14795c"
          emissive={C.jade}
          emissiveIntensity={emissive * 0.55}
          roughness={0.35}
        />
      </mesh>
      <mesh scale={pulse * 1.02}>
        <sphereGeometry args={[1.22, 48, 48]} />
        <meshPhysicalMaterial
          color={C.glow}
          transparent
          opacity={0.16}
          roughness={0.05}
          emissive={C.jade2}
          emissiveIntensity={0.25}
          depthWrite={false}
        />
      </mesh>
      {[
        { r: 1.75, rot: [frame * 0.021 + 0.5, frame * 0.011, 0.2] },
        { r: 2.05, rot: [0.4, frame * -0.016 + 1, frame * 0.013] },
        { r: 2.35, rot: [frame * 0.009 + 2, 0.3, frame * -0.019] },
      ].map((ring, i) => (
        <mesh key={i} rotation={ring.rot as [number, number, number]}>
          <torusGeometry args={[ring.r, 0.045, 20, 160]} />
          <meshStandardMaterial
            color={C.gold}
            metalness={0.85}
            roughness={0.28}
            emissive={C.gold}
            emissiveIntensity={0.45}
          />
        </mesh>
      ))}
      {ORBITS.map((o, i) => {
        const a = frame * o.speed + o.phase;
        const x = Math.cos(a) * o.r;
        const z = Math.sin(a) * o.r;
        const y = Math.sin(a * 1.3 + o.tilt) * 0.7;
        return (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[o.size, 12, 12]} />
            <meshBasicMaterial color={o.gold ? C.goldHi : C.glow} />
          </mesh>
        );
      })}
      {DUST.map((d, i) => {
        const a = d.a + frame * 0.006;
        return (
          <mesh key={i} position={[Math.cos(a) * d.r, d.y, Math.sin(a) * d.r]}>
            <sphereGeometry args={[d.s, 6, 6]} />
            <meshBasicMaterial color={C.glow} />
          </mesh>
        );
      })}
    </group>
  );
};

export const Wisp: React.FC<{
  width: number;
  height: number;
  scale?: number;
  offsetY?: number;
}> = ({ width, height, scale = 1, offsetY = 0 }) => (
  <ThreeCanvas
    width={width}
    height={height}
    camera={{ position: [0, 0, 7.5], fov: 40 }}
    style={{ position: "absolute", left: 0, top: 0 }}
  >
    <ambientLight intensity={0.55} />
    <directionalLight position={[3, 4, 5]} intensity={1.6} />
    <directionalLight position={[-4, -2, 3]} intensity={0.6} color={C.gold} />
    <pointLight position={[0, 0, 0]} intensity={6} distance={7} color={C.jade2} />
    <WispModel scale={scale} offsetY={offsetY} />
  </ThreeCanvas>
);
