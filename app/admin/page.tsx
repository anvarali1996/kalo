import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
import { isAdminUser } from "@/lib/admin-access";
import { currentUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Admin | KALO", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const viewer = await currentUser();
  if (!viewer) redirect("/");
  if (!isAdminUser(viewer.id)) notFound();
  return <AdminPanel viewerId={viewer.id}/>;
}
