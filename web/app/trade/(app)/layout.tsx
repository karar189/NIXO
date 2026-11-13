import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const metadata: Metadata = {
  title: "Dashboard — NIXO Trade",
};

export default function DashboardLayout({ children }: LayoutProps<"/trade">) {
  return <DashboardShell>{children}</DashboardShell>;
}
