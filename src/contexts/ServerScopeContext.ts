import { createContext, useContext } from "react";

/**
 * The relay (server) currently being viewed. Lets deeply-nested presentational
 * components (message rows, member rows, voice avatars, mentions) resolve a
 * user's per-server nickname without every caller threading the relay URL
 * down. `undefined` means "no server scope" (e.g. DMs), in which case the
 * global profile name is used and no per-server nickname is applied.
 */
export const ServerScopeContext = createContext<string | undefined>(undefined);

/** Read the current server (relay URL) scope, if any. */
export function useServerScope(): string | undefined {
  return useContext(ServerScopeContext);
}
