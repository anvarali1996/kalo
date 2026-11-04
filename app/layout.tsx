import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KALO — Your healthy balance",
  description: "Multilingual calorie tracker, weight goals and barcode nutrition scanner.",
  applicationName: "KALO",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="uz"><body>{children}</body></html>;
}
