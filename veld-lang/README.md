# Veld Language

A statically-typed scripting language that runs entirely in the browser.
No build tools. No dependencies. One `<script>` tag.

```veld
fn fib(n: Int) -> Int {
  if n <= 1 { return n }
  return fib(n - 1) + fib(n - 2)
}
for i in 0..10 { println("fib(" + to_str(i) + ") = " + to_str(fib(i))) }
```

## License

This repository — the language engine, syntax highlighter, and playground — is
licensed under the **PolyForm Noncommercial License 1.0.0** (see [LICENSE](LICENSE)).

**Free for:** personal projects, education, research, open-source work.
**Not free for:** commercial products, SaaS, internal business tooling.

For commercial licensing: **nusalexia@gmail.com**

## Veld ADE (Agentic Development Environment)

The full Veld ADE — multi-file editor, Canvas panel, REPL, FFI registry — is a
separate **commercial product** and is not included in this repository.

→ Purchase a license: [nusalexia.com](https://nusalexia.com)

## Quick Start

Open `playground/index.html` directly in any modern browser. No server needed.

Or embed the engine in your own page:

```html
<script src="src/veld-engine.js"></script>
<script>
  const ast = new Parser(tokenize(`println("Hello!")`)).parseProgram();
  new Interpreter(t => console.log(t)).run(ast);
</script>
```

## Features

| Feature | Status |
|---|---|
| Variables, constants, type annotations | ✅ |
| Functions, lambdas, closures | ✅ |
| Structs + `impl` blocks + operator overloading | ✅ |
| Pattern matching, destructuring | ✅ |
| Modules (`module`, `use`, `export`, `import`) | ✅ |
| Tail-call optimization | ✅ |
| Static type checker (warnings, non-blocking) | ✅ |
| FFI — call JS functions from Veld | ✅ |
| `loop frame` — animation loop | ✅ |
| Linter (brace matching, line length) | ✅ |

## Language Reference → [docs/language-reference.md](docs/language-reference.md)

## Versioning

| Version | Notes |
|---|---|
| v1.0–v1.2 | Core engine: lexer, parser, interpreter, structs, TCO |
| v1.3 | async/await, Canvas FFI, module export/import |
| v1.4 | UMD module format, `options.scheduleFrame` abstraction |
