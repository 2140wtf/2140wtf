import { PollsViewContext, type PollsView } from '@/lib/pollsViewContext';

export function PollsViewProvider({
  view,
  children,
}: {
  view: PollsView;
  children: React.ReactNode;
}) {
  return <PollsViewContext.Provider value={view}>{children}</PollsViewContext.Provider>;
}
