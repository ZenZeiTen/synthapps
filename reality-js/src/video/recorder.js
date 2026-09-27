// Render the scene's timeline to a video file.
//
// Every frame is path traced to `samples` per pixel with real motion blur
// (each sample sees a different instant inside the shutter), then encoded
// with WebCodecs at an exact timestamp and written to WebM. Where WebCodecs
// is missing, frames are returned as PNG images instead.

import { WebMMuxer } from './webm.js';
import { canvasBlob } from '../reality.js';

const CODECS = [
  { webcodecs: 'vp09.00.10.08', matroska: 'V_VP9' },
  { webcodecs: 'vp8', matroska: 'V_VP8' },
];

// reality: a loaded Reality. Returns { blob, type, frames } where `frames`
// is only set for PNG output.
export async function renderVideo(reality, {
  fps = reality.fps ?? 24,
  duration = reality.duration,
  samples = reality.scene.renderSettings.video_samples,
  bitrate = 12e6,
  format = 'webm',
  onProgress,
  signal,
} = {}) {
  if (!(duration > 0)) throw new Error('the scene has no timeline; add timeline { duration: 4s }');
  const total = Math.max(1, Math.round(duration * fps));
  const { width, height } = reality.renderer;
  reality.stop();

  const codec = format === 'webm' ? await pickCodec(width, height, fps, bitrate) : null;
  if (!codec) {
    const frames = [];
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('video rendering was cancelled');
      await reality.renderFrame(i, { samples, fps, onProgress: (s) => onProgress?.({ frame: i, frames: total, samples: s, of: samples }) });
      frames.push(await canvasBlob(reality.canvas));
    }
    return { frames, type: 'image/png' };
  }

  const muxer = new WebMMuxer({ width, height, codec: codec.matroska, fps });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      muxer.addFrame(data, chunk.timestamp / 1000, chunk.type === 'key');
    },
    error: (e) => { failure = e; },
  });
  encoder.configure({ codec: codec.webcodecs, width, height, bitrate, framerate: fps });

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) { encoder.close(); throw new Error('video rendering was cancelled'); }
    if (failure) throw failure;
    await reality.renderFrame(i, { samples, fps, onProgress: (s) => onProgress?.({ frame: i, frames: total, samples: s, of: samples }) });
    const frame = new VideoFrame(reality.canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  const bytes = muxer.finish();
  return { blob: new Blob([bytes], { type: 'video/webm' }), bytes, type: 'video/webm', codec: codec.matroska };
}

async function pickCodec(width, height, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of CODECS) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec: c.webcodecs, width, height, bitrate, framerate: fps });
      if (supported) return c;
    } catch { /* try the next codec */ }
  }
  return null;
}
