/**
 * Imported first by the desktop launcher. Hides Node's "SQLite is an experimental feature" warning, which means
 * nothing to someone who double-clicked an app. Every other warning still prints.
 */
const original = process.emitWarning.bind(process) as (...args: unknown[]) => void;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.includes("SQLite is an experimental feature")) return;
  original(warning, ...rest);
}) as typeof process.emitWarning;

export {};
