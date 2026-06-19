import { useId } from 'react';

/**
 * Generate a unique ID per component instance so that clip-path and gradient
 * IDs don't collide when the same Pets is rendered in multiple places at
 * once (e.g. hero + drawer grid, hero + floating companion, feed card + companion).
 *
 * React's useId() returns strings like ":r0:" — strip non-alphanumeric chars
 * to produce valid SVG ID characters.
 */
export function usePetsInstanceId(petsId: string): string {
  const reactId = useId();
  return `${petsId}-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
}
