import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KALO — Kaloriya va vazn nazorati",
    short_name: "KALO",
    description: "Kaloriya hisoblash, ovqat kundaligi va barcode skaneri",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8f3",
    theme_color: "#285a43",
    lang: "uz",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
