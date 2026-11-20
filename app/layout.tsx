import type { Metadata } from "next";
import { appName } from "@/lib/brand";
import "./globals.css";

const description = "Track meals, scan barcodes or food photos, and follow a calorie plan based on your goals.";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "kalo-steel.vercel.app"}`),
  title: appName,
  description,
  applicationName: appName,
  openGraph: {
    type: "website",
    siteName: appName,
    title: appName,
    description,
    images: [{ url: "/balance-bowl.jpg", width: 1200, height: 800, alt: "A bowl of chicken, grains and vegetables" }],
  },
  twitter: { card: "summary_large_image" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: appName },
  icons: {
    icon: { url: "/icons/kalo-balance-192.png", sizes: "192x192", type: "image/png" },
    apple: { url: "/icons/kalo-balance-apple-touch.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport = { themeColor: "#285a43", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="uz"><body>{children}</body></html>;
}
