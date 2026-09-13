export interface ActivityEntry {
  id: number;
  agentKey: string;
  level: string;
  message: string;
  createdAt: string;
}

const levelColor: Record<string, string> = {
  info: "text-neutral-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Nothing logged yet — once core starts running, activity shows up here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-800">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-4 py-2 text-sm">
          <span className={levelColor[e.level] ?? levelColor.info}>
            <span className="font-mono text-xs text-neutral-600">[{e.agentKey}]</span>{" "}
            {e.message}
          </span>
          <span className="shrink-0 text-xs text-neutral-600">
            {new Date(e.createdAt).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
