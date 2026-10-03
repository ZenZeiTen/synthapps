/**
 * Minimal glob matcher shared by tool policies, agent tool lists and trigger rules.
 * Supports `*` (no slash), `**` (any, including slashes), `?` and `{a,b}`.
 * Tool names use "." as separator, so for tool globs `*` also matches dots: pass {dots: true}.
 */
export function globToRegExp(glob: string, opts: { dots?: boolean } = {}): RegExp {
  let re = "";
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // "**/" also matches zero directories
      } else {
        re += opts.dots ? ".*" : "[^/]*";
      }
    } else if (c === "?") re += opts.dots ? "." : "[^/]";
    else if (c === "{") {
      inGroup = true;
      re += "(?:";
    } else if (c === "}" && inGroup) {
      inGroup = false;
      re += ")";
    } else if (c === "," && inGroup) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(value: string, glob: string, opts: { dots?: boolean } = {}): boolean {
  return globToRegExp(glob, opts).test(value);
}

export function matchAny(value: string, globs: string[] | undefined, opts: { dots?: boolean } = {}): boolean {
  return (globs ?? []).some((g) => matchGlob(value, g, opts));
}
