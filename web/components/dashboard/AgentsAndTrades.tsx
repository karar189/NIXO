import { Bot, Plus } from "lucide-react";
import { Card } from "./Card";

export function AgentsCard() {
  return (
    <Card
      title="Your agents"
      action={
        <button
          type="button"
          disabled
          title="Agent creation is coming soon"
          className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-background opacity-50"
        >
          <Plus className="size-3.5" /> New agent
        </button>
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent">
          <Bot className="size-5" />
        </span>
        <p className="mt-4 font-medium">No agents yet</p>
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted">
          Each agent gets its own sub-account under your NEAR account, with a key limited to the
          contracts you approve. Agent creation is coming soon.
        </p>
      </div>
    </Card>
  );
}

const TRADE_COLUMNS = ["Agent", "Pair", "Side", "Size", "Price", "Status", "Time"];

export function RecentTrades() {
  return (
    <Card title="Recent trades">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {TRADE_COLUMNS.map((c) => (
                <th key={c} scope="col" className="pb-3 pr-4 font-mono text-[11px] font-normal uppercase tracking-wider text-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={TRADE_COLUMNS.length} className="py-10 text-center text-sm text-muted">
                No trades yet. Paper and live trades from your agents will show up here.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
