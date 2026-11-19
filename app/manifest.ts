import type { MetadataRoute } from "next";
import { appName } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appName,
    short_name: appName,
    description: "Kaloriya hisobi, ovqat kundaligi, shtrix-kod skaneri va AI orqali ovqatni aniqlash",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8f3",
    theme_color: "#285a43",
    orientation: "any",
    lang: "uz",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
