import { notFound } from "next/navigation";
import { getRequiredSession } from "@/lib/current-user";
import { getAppSettings } from "@/lib/app-settings";
import { SettingsForm } from "@/components/SettingsForm";

export default async function SettingsPage() {
  const session = await getRequiredSession();
  // 404 (not 403) so the page is invisible to non-owners rather than
  // advertising its existence.
  if (session.role !== "OWNER") notFound();

  const settings = await getAppSettings();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
