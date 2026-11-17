import { Capacitor } from '@capacitor/core';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Saves a file the person asked for. In the Android app it writes the file
 * to the app's cache and opens the system share sheet (save to Files,
 * Drive, email, WhatsApp...). In a browser it downloads the file.
 */
export async function saveFile(name: string, blob: Blob): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const data = await blobToBase64(blob);
    const written = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title: name, url: written.uri, dialogTitle: 'Save or send' });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** True when the browser can hand a file to another app (phones, mostly). */
export function canShareFiles(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  try {
    const probe = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareFile(name: string, blob: Blob, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await saveFile(name, blob);
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  await navigator.share({ files: [file], title });
}
