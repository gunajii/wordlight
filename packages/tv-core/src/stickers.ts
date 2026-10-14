// Stickers: a small, score-free reward. A reader gets a sticker on a book's shelf card once they finish that book
// (from the server's per-reader records: story ids only). No points, no ranking, nothing ever taken away.
export type Stickers = Record<string, string[]>; // readerId → finished story ids
export interface StickerReader { readerId: string; firstName: string; online?: boolean }

/** The first name to show on a book's card: the online reader who finished it (else null). */
export function stickerFor(stickers: Stickers, readers: StickerReader[], storyId: string): string | null {
  const r = readers.find((x) => x.online && (stickers[x.readerId] ?? []).includes(storyId));
  return r ? r.firstName : null;
}

/** True when finishing this story earns the online reader a NEW sticker (they had not finished it before). */
export function isNewSticker(stickers: Stickers, reader: StickerReader | null | undefined, storyId: string, completed: boolean): boolean {
  return !!reader && completed && !(stickers[reader.readerId] ?? []).includes(storyId);
}

/** How many different books a reader has finished. */
export const stickerCount = (stickers: Stickers, readerId: string) => new Set(stickers[readerId] ?? []).size;
