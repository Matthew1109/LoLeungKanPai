/**
 * Hands a finished backup to the user: the iOS share sheet when the browser can share files (Save to Files, AirDrop,
 * iCloud Drive...), otherwise an ordinary download. Must be called straight from a tap: the share sheet needs a
 * fresh user gesture, which is why creating and saving are two separate buttons.
 *
 * 'cancelled' means the user closed the share sheet, so nothing was saved. The app can never see where a shared
 * file ended up; the screen says so.
 */
export type DeliverOutcome = 'shared' | 'downloaded' | 'cancelled';

interface ShareCapable {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
}

export async function deliverBackup(blob: Blob, fileName: string): Promise<DeliverOutcome> {
  const file = new File([blob], fileName, { type: 'application/zip' });
  const nav = navigator as unknown as ShareCapable;
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] }) === true) {
    try {
      await nav.share({ files: [file], title: fileName });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other refusal (for example an expired gesture): fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
