/**
 * Trust the operating system's certificate store as well as Node's bundled one, the way browsers do.
 *
 * Node checks TLS against its own bundled list only. On a network that inspects TLS with a company certificate (common
 * in offices), the browser works but Nalara could not reach Claude. Adding the system store fixes that, and changes
 * nothing elsewhere: the bundled certificates stay trusted.
 */
import tls from "node:tls";

interface TlsCaApi {
  getCACertificates?: (type?: "default" | "system" | "bundled" | "extra") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
}

/** Returns how many system certificates were added (0 when the Node version cannot read the system store). */
export function trustSystemCertificates(api: TlsCaApi = tls as unknown as TlsCaApi): number {
  if (typeof api.getCACertificates !== "function" || typeof api.setDefaultCACertificates !== "function") return 0;
  try {
    const system = api.getCACertificates("system");
    if (!system.length) return 0;
    api.setDefaultCACertificates([...new Set([...api.getCACertificates("default"), ...system])]);
    return system.length;
  } catch {
    return 0;
  }
}
