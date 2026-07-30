/**
 * Codex attaches images by file path (`--image`), not inline base64 like the
 * Claude SDK — so the overlay's screenshots have to land on disk first.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageInput } from "@airship/protocol";

/**
 * The extension is load-bearing, not cosmetic: image format is sniffed from the
 * filename, so a `.png` holding a JPEG is rejected.
 */
function extFor(mediaType: string): string {
  switch (mediaType) {
    case "image/gif":
      return ".gif";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      return ".png";
  }
}

export interface ImageScratch {
  /** Always call, including on the abort path. */
  dispose: () => void;
  paths: string[];
}

/**
 * Write each image to a fresh temp directory.
 *
 * Deliberately under `os.tmpdir()` rather than the project: files written into
 * the working tree would show up in the user's `git status` *and* be picked up
 * by the adapter's dirty-file scan as though the agent had authored them.
 */
export function writeImages(images?: ImageInput[]): ImageScratch {
  if (!images?.length) {
    return { dispose: () => undefined, paths: [] };
  }
  const dir = mkdtempSync(join(tmpdir(), "airship-img-"));
  const paths: string[] = [];
  for (const [i, img] of images.entries()) {
    const path = join(dir, `${i}${extFor(img.mediaType)}`);
    writeFileSync(path, Buffer.from(img.dataBase64, "base64"));
    paths.push(path);
  }
  return {
    dispose: () => {
      try {
        rmSync(dir, { force: true, recursive: true });
      } catch {
        // A leaked temp dir is not worth failing an otherwise-good edit over.
      }
    },
    paths,
  };
}
