import { requireAuth } from "@/lib/auth";
import { AppShell } from "@/components/shell";
import { getSystemStatusData } from "@/lib/data";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const systemStatus = await getSystemStatusData();
  return <AppShell systemStatus={systemStatus}>{children}</AppShell>;
}
