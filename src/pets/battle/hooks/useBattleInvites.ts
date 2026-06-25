import { useRemoteBattle } from './useRemoteBattle';

/**
 * Convenience hook that exposes only the incoming invite state and actions.
 *
 * Useful for overlays that don't need the full remote-battle state machine.
 */
export function useBattleInvites() {
  const {
    pendingInvite,
    isLoadingInbox,
    acceptPendingInvite,
    declinePendingInvite,
  } = useRemoteBattle();

  return {
    pendingInvite,
    isLoading: isLoadingInbox,
    accept: acceptPendingInvite,
    decline: declinePendingInvite,
  };
}
