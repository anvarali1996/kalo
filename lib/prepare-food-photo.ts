/** Resize on the device to stay below Vercel's request limit and strip photo metadata. */
export async function prepareFoodPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("aiInvalidPhoto");
  if (file.size > 15 * 1024 * 1024) throw new Error("aiPhotoTooLarge");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("aiInvalidPhoto");
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("aiInvalidPhoto");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", 0.85);
    if (!result.startsWith("data:image/jpeg;base64,")) throw new Error("aiInvalidPhoto");
    if (result.length > 3_333_355) throw new Error("aiPhotoTooLarge");
    return result;
  } finally { URL.revokeObjectURL(url); }
}
