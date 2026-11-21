import React from "react";
import { Audio } from "@remotion/media";
import { Easing, interpolate, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Sfx } from "./components/Chip";
import { S1Intro } from "./scenes/S1Intro";
import { S2Hook } from "./scenes/S2Hook";
import { S3Browse } from "./scenes/S3Browse";
import { S4Translate } from "./scenes/S4Translate";
import { S5Tms } from "./scenes/S5Tms";
import { S6Oracle } from "./scenes/S6Oracle";
import { S7Ext } from "./scenes/S7Ext";
import { S8Secure } from "./scenes/S8Secure";
import { S9Outro } from "./scenes/S9Outro";
import { SCENES, T, TOTAL } from "./theme";

const timing = linearTiming({
  durationInFrames: T,
  easing: Easing.inOut(Easing.cubic),
});

// Global start frame of each scene after the first (where a transition begins).
const order = [
  SCENES.intro,
  SCENES.hook,
  SCENES.browse,
  SCENES.translate,
  SCENES.tms,
  SCENES.oracle,
  SCENES.ext,
  SCENES.secure,
];
const starts: number[] = [];
order.reduce((acc, d) => {
  const next = acc + d - T;
  starts.push(next);
  return next;
}, 0);

export const LintasPromo: React.FC = () => (
  <>
    <Audio
      src={staticFile("music.m4a")}
      volume={(f) =>
        0.7 * interpolate(f, [TOTAL - 30, TOTAL], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
    {starts.map((s) => (
      <Sfx key={s} name="whoosh" at={s} volume={0.35} />
    ))}
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={210}>
        <S1Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence name="Hook" durationInFrames={120}>
        <S2Hook />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={timing} />
      <TransitionSeries.Sequence name="Browse" durationInFrames={360}>
        <S3Browse />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={wipe({ direction: "from-left" })} timing={timing} />
      <TransitionSeries.Sequence name="Translate" durationInFrames={360}>
        <S4Translate />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={timing} />
      <TransitionSeries.Sequence name="TMS" durationInFrames={450}>
        <S5Tms />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence name="Oracle" durationInFrames={450}>
        <S6Oracle />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={timing} />
      <TransitionSeries.Sequence name="Extensions" durationInFrames={360}>
        <S7Ext />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence name="Secure" durationInFrames={240}>
        <S8Secure />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={270}>
        <S9Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </>
);
