/**
 * TestnetSurface — the guard behind the `/testnet/*` route namespace.
 *
 * The network is a query dimension, not a route dimension: `getBaoNetwork()`
 * (src/lib/baoNetwork.ts) reads `?network=` first and the persisted choice
 * second, and every data path — API base, relay, market `n` tag — re-reads it
 * at call time. The module's own comment states the design: the selection is
 * "applied by a reload so every existing query/market/wallet path uses the
 * same network without threading a new context through the whole app".
 *
 * So a `/testnet/bao/markets` link must not render the surface first and then
 * mutate a context: it has to land on a URL that already carries the
 * parameter, or the first render fetches demo data. This keeps the path the
 * reader was given and adds `network=testnet` to it.
 *
 * An explicit `?network=demo` is honoured rather than overridden: that is what
 * the in-app switch writes before reloading, and a namespace that fights it
 * would trap anyone in testnet with no way back.
 */
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

export function TestnetSurface({ children }: { children: ReactNode }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requested = params.get("network");
  if (requested === "testnet" || requested === "demo") return <>{children}</>;
  params.set("network", "testnet");
  const search = params.toString();
  return <Navigate to={`${location.pathname}${search ? `?${search}` : ""}`} replace />;
}

export default TestnetSurface;
