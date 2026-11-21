// A native messaging host for the end-to-end test: sends back every message it gets.
// Messages are a 32-bit length (native byte order) and UTF-8 JSON, as Chrome sends them.
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    const out = Buffer.from(JSON.stringify({ ...msg, echoedBy: 'echo-host', args: process.argv.slice(2) }), 'utf8');
    const head = Buffer.alloc(4); head.writeUInt32LE(out.length, 0);
    process.stdout.write(Buffer.concat([head, out]));
  }
});
process.stdin.on('end', () => process.exit(0));
