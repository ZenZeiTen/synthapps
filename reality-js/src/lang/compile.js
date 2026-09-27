// Source text in, Scene out.

import { parse } from './parser.js';
import { evaluate } from './evaluator.js';
import { buildScene } from '../scene/scene.js';

// `imports` maps a path used in `import "..."` to its source text.
export function compile(source, { imports = {} } = {}) {
  const program = parse(source);
  const parsedImports = new Map();
  for (const [path, text] of Object.entries(imports)) parsedImports.set(path, parse(text));
  const { nodes, warnings } = evaluate(program, { imports: parsedImports });
  return buildScene(nodes, warnings);
}

// Paths named by top-level `import` statements, so a caller can fetch them
// before compiling.
export function importPaths(source) {
  return parse(source).body.filter((s) => s.type === 'Import').map((s) => s.path);
}
