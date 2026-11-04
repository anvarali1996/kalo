import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KALO — Your healthy balance",
  description: "Multilingual calorie tracker, weight goals and barcode nutrition scanner.",
  applicationName: "KALO",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "KALO" },
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport = { themeColor: "#285a43", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="uz"><body>{children}</body></html>;
}
