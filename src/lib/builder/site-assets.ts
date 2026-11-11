import sharp from "sharp";

/** Pictures an owner attaches in the chat. Converted to WebP here, so the site only ever holds small WebP files. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_ASSETS_PER_PROJECT = 8;
export const MAX_ASSETS_PER_CHANGE = 3;
/** Wider than this is shrunk. 2400 px is sharp on a 1440 px screen at 2x and keeps files small. */
export const MAX_WIDTH = 2400;
const MAX_INPUT_PIXELS = 40_000_000;
const ALLOWED = new Set(["jpeg", "png", "webp"]);

export type ConvertedImage = { bytes: Buffer; width: number; height: number; size: number };
export class UploadError extends Error {}

/**
 * JPG, PNG or WebP in, WebP out. The type is read from the file's own bytes, not its name or the type the browser sent.
 * The picture is turned upright (phone photos carry a rotation flag), shrunk to MAX_WIDTH if wider, and location and camera data is dropped.
 * SVG and anything else is refused: an SVG can carry scripts.
 */
export async function convertToWebp(input: Buffer, maxInputBytes: number = MAX_UPLOAD_BYTES): Promise<ConvertedImage> {
  if (input.length === 0) throw new UploadError("That file is empty.");
  if (input.length > maxInputBytes) throw new UploadError("That picture is over 3 MB. Please send a smaller one.");
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UploadError("I could not read that file. Please send a JPG, PNG or WebP picture.");
  }
  if (!meta.format || !ALLOWED.has(meta.format)) throw new UploadError("Please send a JPG, PNG or WebP picture.");
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height, size: data.length };
  } catch {
    throw new UploadError("I could not convert that picture. Please try another one.");
  }
}

/** A short, safe name for display: no path, at most 60 characters. */
export const cleanFileName = (name: string): string =>
  (name.split(/[\\/]/).pop() ?? "").replace(/[^\w .()-]/g, "").trim().slice(0, 60) || "picture";

/** What the agent is told about attached pictures. The files are already in the site's public/art folder. */
export function attachmentNote(assets: { id: string; name: string; width: number; height: number }[]): string {
  if (!assets.length) return "";
  const lines = assets.map((a) => `- /art/${a.id}.webp (${a.width} by ${a.height} pixels, from the owner's file "${a.name}")`);
  return [
    "",
    "The owner attached these pictures. They are already saved in the site's public/art folder and are served at the paths below. Use them exactly as given: do not recolour, redraw, crop or stretch them.",
    ...lines,
    "Look at each picture and write a short plain alt text that describes what it shows. Show it inside its frame with object-fit contain or cover, whichever suits its shape. If it fails to load, the page must still look right (no broken-image icon).",
  ].join("\n");
}
