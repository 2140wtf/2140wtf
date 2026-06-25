import { Zap, Coins, Ruler, Gauge } from 'lucide-react';

import { type ChaseGameState, type ChaseMode, CHASE_RAILS } from './types';

interface ChaseHudProps {
  state: ChaseGameState;
  mode: ChaseMode;
}

export function ChaseHud({ state, mode }: ChaseHudProps) {
  return (
    <div className="absolute top-0 inset-x-0 p-3 sm:p-4 pointer-events-none">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-sm font-semibold shadow-sm border">
            <Ruler className="size-3.5 text-muted-foreground" />
            {Math.floor(state.distance).toLocaleString()}m
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-sm font-semibold shadow-sm border">
            <Gauge className="size-3.5 text-muted-foreground" />
            {state.speed.toFixed(1)}
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-sm font-semibold shadow-sm border">
            {mode === 'sats' ? (
              <Zap className="size-3.5 text-amber-500" />
            ) : (
              <Coins className="size-3.5 text-yellow-500" />
            )}
            {state.result.score.toLocaleString()}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {state.status === 'running' && (
            <div className="rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm border">
              {state.result.coinsCollected} coins
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[45vw]">
            {CHASE_RAILS.map((rail) => {
              const count = state.result.coinsByRail[rail.id] ?? 0;
              return (
                <div
                  key={rail.id}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold border shadow-sm"
                  style={{ backgroundColor: rail.bg, color: rail.color, borderColor: rail.color }}
                >
                  <span>{rail.icon}</span>
                  <span>{rail.label}</span>
                  <span className="opacity-70">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
