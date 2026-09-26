---
name: "game-music-forge"
description: "Create, source, loop and integrate original background music and jingles for any game project (browser/Canvas, Three.js, Godot, Unity, Blender cutscenes). Use for 'add music to my game', 'game soundtrack', 'BGM', 'musik latar game'."
---

# Game Music Forge

Engine-agnostic music workflow, proven on a shipped browser arcade game (Sep 2026). Other game skills (browser-arcade-game-forge, threejs-retro-forge, hd2d-forge, game-creator-2d, Unity/Godot work) hand off to this one for music.

## 1. Music brief (from the game, not from scratch)
Read the game's setting, pacing and states, then write one line per cue:
- **Gameplay loop** (required): genre, mood, instruments, BPM, "consistent energy so it loops cleanly", "Instrumental".
- Optional cues: title screen, boss/danger, level clear jingle (5-10 s), game over jingle (5-10 s).
Let the setting colour the music: blend the instruments and scales of the game's world (for example gamelan metallophones and a slendro/pelog feel for a Javanese setting) with its era style (chiptune, synthwave, orchestral...).

## 2. Originality rule
- Genre or era styles are fine ("16-bit adventure", "PS1 dungeon ambience").
- Never ask for, hum out, or rebuild a named game's theme, a composer's melody, or a song. No "sounds like the X theme" prompts.
- Keep a credits line for every track (source, date, tool) in the game and in a MUSIC_CREDITS.md next to the project.

## 3. Sourcing ladder
1. **A music-generation connector** (for example vidIQ's music tool or ElevenLabs music, whichever the user has connected): ask for an original, instrumental track; ~60 s for loops, ~10 s for jingles. Poll the job until it finishes. Check the tool's licence terms before shipping the track in a build. If a safety filter blocks a prompt, suggest ONE rephrase and wait for the user.
2. **A second generator**, if the first is missing or out of credits. Check its scope once; don't retry a permission or scope error.
3. **A stock-music library** (for example Epidemic Sound): fine for videos and trailers under the user's own subscription; for music embedded in a shareable build or page, use it only when the licence clearly covers that.
4. **Code-written fallback** (browser/Three.js only): an original WebAudio chiptune with a lookahead scheduler. Ship it first so the game is never silent.

State the cost (credits or money) before generating more than two tracks.

## 4. Getting the file
- Sandboxed or cloud environments often block the download host (for example an S3 403). Do not work around the network rules.
- If you can reach the user's own machine through a tool, download into the project folder there. Otherwise give the user the link and ask them to add the file to the project.

## 5. Preparing the audio (ffmpeg)
- `ffprobe` first: a generated ".wav" file may really be MP3.
- Compare loudness of the first and last second (`volumedetect`); big gaps mean the loop needs a longer crossfade.
- Seamless loop: body = track from 0.5 s to end; head = first 0.5 s; `[body][head]acrossfade=d=0.5:c1=tri:c2=tri`. Check that the output duration is about the original minus 0.5 s (a near-empty output means the filter graph failed; rebuild it in separate steps).
- Optional: `loudnorm=I=-16:TP=-1.5` so music sits under SFX.
- Jingles: no loop; add a 50 ms fade-in and a short fade-out.

## 6. Engine integration
**Browser / Canvas / Three.js (single-file artifact)**
- Encode MP3 128k (~1 MB/min). Embed as base64 in `<script id="bgm-data" type="text/plain">` (the artifact CSP blocks outside media hosts).
- Decode with `decodeAudioData`; play with `AudioBufferSourceNode` (`loop = true`) into a music GainNode.
- Start on the first user gesture; pause/resume by tracking the playback offset; optional per-level speed-up (max +8%).
- Controls: B (and a touch button) toggles music, remembered in localStorage (try/catch); M mutes all.
- Keep the code chiptune as fallback when decoding fails.

**Godot 4**
- Encode OGG Vorbis (`libvorbis -q:a 5`). Import as AudioStreamOggVorbis with `loop = true` (use `loop_offset` if the intro should not repeat).
- A `Music` audio bus; an autoload `MusicManager` with two AudioStreamPlayers for crossfades between cues via Tween.

**Unity 6**
- Import OGG; for music clips set Load Type = Streaming, Compression = Vorbis. AudioSource with Loop on, routed to a `Music` group in an AudioMixer (use a Unity audio-mixer skill if one is installed).
- Crossfade cues with two AudioSources; expose music volume as a mixer parameter.

**Blender cutscene / animation**
- No looping: fit or trim the track to the shot length, fade the tail, add it as a sound strip in the Video Sequencer before rendering.

## 7. Verify
- Browser: headless Playwright run with no page errors, plus a decode check of the embedded track (duration, channels).
- Godot/Unity: confirm the import settings in the project files (.import / .meta).
- Always say that mix levels and the loop seam were not checked by ear unless the user confirms.

## 8. Report
Which cues exist, where each came from (tool, credits used), how it loops, how to toggle it, and what is untested.