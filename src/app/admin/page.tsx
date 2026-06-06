import { BarChart3, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { sportsProviderLabels } from "@/lib/server-config";
import { dataUpdatedIso, deadlineIso } from "@/lib/tournament-data";

export default function AdminPage() {
  const providers = sportsProviderLabels();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Admin status</p>
        <h1 className="mt-1 text-3xl font-black">Group to Glory health check</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          This page is intentionally status-first. Data refreshes and scoring are automated; manual buttons exist only as emergency controls once deployment auth is connected.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <StatusCard icon={<Database />} label="Latest data snapshot" value={new Date(dataUpdatedIso).toLocaleString()} />
        <StatusCard icon={<ShieldCheck />} label="Amaan's winner freeze" value={`Freezes at ${new Date(deadlineIso).toLocaleString()}`} />
        <StatusCard icon={<RefreshCw />} label="Model refresh cadence" value="Every 12 hours" />
        <StatusCard icon={<BarChart3 />} label="Matchday scoring refresh" value="More often during matchdays" />
      </div>

      <div className="mt-5 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black">Connected keys</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <div key={provider.label} className="flex items-center justify-between rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
              <span className="text-sm font-bold">{provider.label}</span>
              <span className={`rounded-full px-2 py-1 text-xs font-black ${provider.ready ? "bg-emerald-100 text-emerald-900" : "bg-stone-100 text-stone-500"}`}>
                {provider.ready ? "Configured" : "Missing"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black">Emergency controls</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action="/api/admin/refresh" method="post">
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-sm font-bold text-white">
              <RefreshCw className="h-4 w-4" />
              Refresh data now
            </button>
          </form>
          <form action="/api/admin/score" method="post">
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold">
              <BarChart3 className="h-4 w-4" />
              Recalculate scores
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function StatusCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-emerald-50 text-emerald-800">
          {icon}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">{label}</p>
          <p className="mt-1 font-black">{value}</p>
        </div>
      </div>
    </div>
  );
}
