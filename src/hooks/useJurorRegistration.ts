import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import {
  buildJurorCandidacyEvent,
  type JurorProfile,
  type StakeCommitment,
} from "@/lib/bao-court";

export interface JurorRegistrationInput {
  readonly disputeId: string;
  readonly marketId: string;
  readonly categories: readonly string[];
  readonly bondAmountSats: number;
  readonly bondAddress: string;
  readonly stakeCapacitySats?: number;
  readonly wotScore?: number;
}

function buildMockStakeCommitment(
  bondAmountSats: number,
  bondAddress: string,
): StakeCommitment {
  return {
    amountSats: bondAmountSats,
    bondAddress,
    status: "confirmed",
    committedAt: Math.floor(Date.now() / 1000),
  };
}

export function useJurorRegistration() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: JurorRegistrationInput) => {
      if (!user) {
        throw new Error("User is not logged in");
      }

      const stakeCommitment = buildMockStakeCommitment(
        input.bondAmountSats,
        input.bondAddress,
      );

      const juror: JurorProfile = {
        nostrPubkey: user.pubkey,
        stakeCapacitySats: input.stakeCapacitySats ?? input.bondAmountSats,
        stakeCommitment,
        wotScore: input.wotScore ?? 80,
        categories: input.categories,
        registeredAt: Math.floor(Date.now() / 1000),
      };

      const template = buildJurorCandidacyEvent({
        disputeId: input.disputeId,
        marketId: input.marketId,
        juror,
        bondAmountSats: input.bondAmountSats,
        bondAddress: input.bondAddress,
      });

      const event = await publishEvent(template);
      return event;
    },
    onSuccess: (_event, input) => {
      // Invalidate any selection-related caches for this dispute.
      queryClient.invalidateQueries({ queryKey: ["bao-court-selection", input.disputeId] });
    },
  });
}
