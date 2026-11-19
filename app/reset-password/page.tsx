import type { Metadata } from "next";
import { ResetPasswordView } from "@/components/reset-password-view";
import { appName } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Reset password | " + appName,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return <ResetPasswordView/>;
}
