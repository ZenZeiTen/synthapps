import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import type { Rollup } from 'vite';

const SENTINEL = 'sk_test_SENTINEL_must_not_ship_9f3a1c';

type BuildResult = Rollup.RollupOutput | Rollup.RollupOutput[] | Rollup.RollupWatcher;

function outputText(result: BuildResult): string {
  const outputs = Array.isArray(result) ? result : [result as Rollup.RollupOutput];
  return outputs
    .flatMap((o) => o.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : String(chunk.source)))
    .join('\n');
}

describe('production bundle', () => {
  it('does not contain the value of VITE_ELEVENLABS_API_KEY', async () => {
    const previous = process.env['VITE_ELEVENLABS_API_KEY'];
    const previousNodeEnv = process.env['NODE_ENV'];
    // vitest runs with NODE_ENV=test, which makes Vite treat the build as a dev build.
    process.env['NODE_ENV'] = 'production';
    process.env['VITE_ELEVENLABS_API_KEY'] = SENTINEL;
    try {
      const result = await build({
        mode: 'production',
        logLevel: 'silent',
        build: { write: false, sourcemap: false },
      });
      expect(outputText(result)).not.toContain(SENTINEL);
    } finally {
      if (previous === undefined) delete process.env['VITE_ELEVENLABS_API_KEY'];
      else process.env['VITE_ELEVENLABS_API_KEY'] = previous;
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previousNodeEnv;
    }
  }, 60_000);
});
