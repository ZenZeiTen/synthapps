import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebMMuxer, readEBML } from '../src/video/webm.js';

test('WebM structure: header, info, track, clusters with key frames', () => {
  const m = new WebMMuxer({ width: 320, height: 180, codec: 'V_VP9', fps: 24 });
  for (let i = 0; i < 60; i++) m.addFrame(new Uint8Array([i, 1, 2, 3]), (i * 1000) / 24, i % 48 === 0);
  const bytes = m.finish();
  const tree = readEBML(bytes);
  assert.equal(tree[0].id, 0x1a45dfa3);
  assert.equal(tree[1].id, 0x18538067);
  assert.equal(tree[1].offset + tree[1].size, bytes.length);
  const seg = tree[1].children;
  const clusters = seg.filter((c) => c.id === 0x1f43b675);
  assert.equal(clusters.length, 2); // a new cluster at each key frame
  const blocks = clusters.flatMap((c) => c.children.filter((b) => b.id === 0xa3));
  assert.equal(blocks.length, 60);
  // First block: track 1, relative time 0, key frame flag.
  const b = blocks[0];
  assert.equal(bytes[b.offset], 0x81);
  assert.equal(bytes[b.offset + 3], 0x80);
  const track = seg.find((c) => c.id === 0x1654ae6b).children[0].children;
  const codec = track.find((c) => c.id === 0x86);
  assert.equal(new TextDecoder().decode(bytes.subarray(codec.offset, codec.offset + codec.size)), 'V_VP9');
});

test('clusters split before relative timestamps overflow 16 bits', () => {
  const m = new WebMMuxer({ width: 2, height: 2 });
  m.addFrame(new Uint8Array([1]), 0, true);
  m.addFrame(new Uint8Array([1]), 31000, false);
  const seg = readEBML(m.finish())[1].children;
  assert.equal(seg.filter((c) => c.id === 0x1f43b675).length, 2);
});
