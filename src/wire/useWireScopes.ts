import { useEffect, useRef } from "react";

import { onWireScopes } from "@/wire/bus";

/**
 * Subscribe a component to wire store-change announcements. The handler is
 * kept in a ref so callers can pass inline closures without resubscribing.
 */
export function useWireScopes(handler: (scopes: ReadonlySet<string>) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onWireScopes((scopes) => ref.current(scopes)), []);
}
