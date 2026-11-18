import { MAX_PHOTO_BYTES } from "./ai-validation";

/** Server-only validation, after the data URL has passed its Zod schema. */
export function validPhotoBytes(image: string) {
  const [header, base64] = image.split(",");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES || bytes.toString("base64") !== base64) return false;
  if (header === "data:image/jpeg;base64") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (header === "data:image/png;base64") return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return header === "data:image/webp;base64" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
