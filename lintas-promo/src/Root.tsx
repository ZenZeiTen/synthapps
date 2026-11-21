import React from "react";
import { Composition, Folder } from "remotion";
import { LintasPromo } from "./LintasPromo";
import { S1Intro } from "./scenes/S1Intro";
import { S2Hook } from "./scenes/S2Hook";
import { S3Browse } from "./scenes/S3Browse";
import { S4Translate } from "./scenes/S4Translate";
import { S5Tms } from "./scenes/S5Tms";
import { S6Oracle } from "./scenes/S6Oracle";
import { S7Ext } from "./scenes/S7Ext";
import { S8Secure } from "./scenes/S8Secure";
import { S9Outro } from "./scenes/S9Outro";
import { FPS, H, SCENES, TOTAL, W } from "./theme";

const scenes = [
  { id: "Intro", component: S1Intro, d: SCENES.intro },
  { id: "Hook", component: S2Hook, d: SCENES.hook },
  { id: "Browse", component: S3Browse, d: SCENES.browse },
  { id: "Translate", component: S4Translate, d: SCENES.translate },
  { id: "TMS", component: S5Tms, d: SCENES.tms },
  { id: "Oracle", component: S6Oracle, d: SCENES.oracle },
  { id: "Extensions", component: S7Ext, d: SCENES.ext },
  { id: "Secure", component: S8Secure, d: SCENES.secure },
  { id: "Outro", component: S9Outro, d: SCENES.outro },
];

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="LintasPromo"
      component={LintasPromo}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={TOTAL}
    />
    <Folder name="Scenes">
      {scenes.map((s) => (
        <Composition
          key={s.id}
          id={s.id}
          component={s.component}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={s.d}
        />
      ))}
    </Folder>
  </>
);
