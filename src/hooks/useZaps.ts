import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { usePublishPreferences } from './usePublishPreferences';
import { useNWC } from '@/hooks/useNWCContext';
import type { NWCConnection } from '@/hooks/useNWC';
import { redactSecrets } from '@/lib/redactSecrets';
import { nip57 } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import type { WebLNProvider } from '@webbtc/webln-types';
import { useQueryClient } from '@tanstack/react-query';
import { notificationSuccess } from '@/lib/haptics';

/**
 * Hook for sending zaps to an event author.
 * Stats (zap count, total sats) come from NIP-85 via useEventStats — this hook
 * only handles the payment flow.
 */
export function useZaps(
  target: Event,
  webln: WebLNProvider | null,
  _nwcConnection: NWCConnection | null,
  onZapSuccess?: (result: { amountSats: number }) => void,
  /**
   * Optional Lightning address (lud16) or LNURL (lud06) that takes precedence
   * over the recipient's kind-0 metadata. Used to honor a NIP-A3 `lightning`
   * payment target, which the user prefers over the profile's `lud16`.
   */
  lnAddressOverride?: string,
  /**
   * Optional NIP-69 poll option index. When provided, the zap request is
   * tagged as a vote on a kind 6969 zap poll.
   */
  pollOption?: string,
  /**
   * Primary hosting relay for NIP-69 poll votes. Must be the same relay hint
   * used in the poll event's `e` and `p` tags.
   */
  primaryRelay?: string,
) {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { isEnabled } = usePublishPreferences();
  const zapsEnabled = isEnabled('zaps');
  const queryClient = useQueryClient();
  const author = useAuthor(target?.pubkey);
  const { sendPayment, getActiveConnection } = useNWC();
  const [isZapping, setIsZapping] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);
  // Ref guard prevents double-zap if two clicks fire before React has flushed
  // the isZapping state update.
  const zapInFlightRef = useRef(false);

  const MAX_ZAP_COMMENT_LENGTH = 1000;
  const MAX_ZAP_AMOUNT_SATS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);

  // Cleanup state when component unmounts
  useEffect(() => {
    return () => {
      setIsZapping(false);
      setInvoice(null);
      zapInFlightRef.current = false;
    };
  }, []);

  const zap = async (amount: number, comment: string) => {
    if (!zapsEnabled) {
      toast({
        title: 'Zaps disabled',
        description: 'Turn on “Zap receipts” in Settings → Privacy & Publishing to send zaps.',
      });
      return;
    }
    if (amount <= 0) {
      return;
    }
    if (amount > MAX_ZAP_AMOUNT_SATS) {
      toast({
        title: 'Amount too large',
        description: 'Zap amount exceeds the maximum allowed.',
        variant: 'destructive',
      });
      return;
    }
    if (comment.length > MAX_ZAP_COMMENT_LENGTH) {
      toast({
        title: 'Comment too long',
        description: `Zap comments must be under ${MAX_ZAP_COMMENT_LENGTH} characters.`,
        variant: 'destructive',
      });
      return;
    }
    if (zapInFlightRef.current) {
      return;
    }
    zapInFlightRef.current = true;
    setIsZapping(true);
    setInvoice(null); // Clear any previous invoice at the start

    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to send a zap.',
        variant: 'destructive',
      });
      zapInFlightRef.current = false;
      setIsZapping(false);
      return;
    }

    if (!target) {
      toast({
        title: 'Event not found',
        description: 'Could not find the event to zap.',
        variant: 'destructive',
      });
      zapInFlightRef.current = false;
      setIsZapping(false);
      return;
    }

    try {
      if (!author.data || !author.data?.metadata || !author.data?.event ) {
        toast({
          title: 'Author not found',
          description: 'Could not find the author of this item.',
          variant: 'destructive',
        });
        zapInFlightRef.current = false;
        setIsZapping(false);
        return;
      }

      const { lud06, lud16 } = author.data.metadata;
      // A NIP-A3 lightning payment target takes precedence over the kind-0
      // lud16/lud06. When present, resolve the zap endpoint from a synthetic
      // metadata event carrying the override instead of the profile's own.
      const overrideTrimmed = lnAddressOverride?.trim();
      if (!lud06 && !lud16 && !overrideTrimmed) {
        toast({
          title: 'Lightning address not found',
          description: 'The author does not have a lightning address configured.',
          variant: 'destructive',
        });
        zapInFlightRef.current = false;
        setIsZapping(false);
        return;
      }

      // Get zap endpoint using the old reliable method. When an override is
      // present, build a synthetic kind-0 event so getZapEndpoint resolves the
      // override's LNURL instead of the profile's.
      let endpointEvent = author.data.event;
      if (overrideTrimmed) {
        const isLnurl = /^lnurl1/i.test(overrideTrimmed);
        endpointEvent = {
          ...author.data.event,
          content: JSON.stringify(
            isLnurl ? { lud06: overrideTrimmed } : { lud16: overrideTrimmed },
          ),
        };
      }
      const zapEndpoint = await nip57.getZapEndpoint(endpointEvent);
      if (!zapEndpoint) {
        toast({
          title: 'Zap endpoint not found',
          description: 'Could not find a zap endpoint for the author.',
          variant: 'destructive',
        });
        zapInFlightRef.current = false;
        setIsZapping(false);
        return;
      }

      const zapAmount = amount * 1000; // convert to millisats

      // Create zap request - use appropriate event format based on kind
      // For addressable events (30000-39999), pass the object to get 'a' tag
      // For all other events, omit `event` so nip57 emits an 'e' tag from the
      // caller's context (profile-only zap request).
      const baseZapParams = {
        pubkey: target.pubkey,
        amount: zapAmount,
        relays: config.relayMetadata.relays.map(r => r.url),
        comment,
      };

      const zapRequest = (target.kind >= 30000 && target.kind < 40000)
        ? nip57.makeZapRequest({ ...baseZapParams, event: target })
        : nip57.makeZapRequest(baseZapParams);

      // NIP-69 zap poll vote: ensure the zap request references the poll
      // event (`e` tag) and the recipient (`p` tag) with the primary hosting
      // relay hint, then append the selected option.
      if (pollOption !== undefined) {
        const relay = primaryRelay || config.relayMetadata.relays[0]?.url;
        let hasETag = false;
        zapRequest.tags = zapRequest.tags.map((tag) => {
          if (tag[0] === 'p' && relay) return ['p', tag[1], relay];
          if (tag[0] === 'e') {
            hasETag = true;
            return relay ? ['e', tag[1], relay] : tag;
          }
          return tag;
        });
        if (!hasETag) {
          zapRequest.tags.push(relay ? ['e', target.id, relay] : ['e', target.id]);
        }
        zapRequest.tags.push(['poll_option', pollOption]);
      }

      // Sign the zap request (but don't publish to relays - only send to LNURL endpoint)
      if (!user.signer) {
        throw new Error('No signer available');
      }
      const signedZapRequest = await user.signer.signEvent(zapRequest);

      try {
        const zapUrl = new URL(zapEndpoint);
        zapUrl.searchParams.set('amount', String(zapAmount));
        zapUrl.searchParams.set('nostr', JSON.stringify(signedZapRequest));

        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 30000);
        let res: Response;
        try {
          res = await fetch(zapUrl.toString(), { signal: controller.signal });
        } finally {
          clearTimeout(fetchTimeout);
        }
        const responseText = await res.text();
        let responseData: { pr?: string; reason?: string } = {};

        try {
          responseData = responseText ? JSON.parse(responseText) : {};
        } catch (parseError) {
          // Some LNURL providers return plain text/html for server errors.
          console.warn('Failed to parse zap callback response as JSON', parseError);
        }

        if (!res.ok) {
          const fallbackReason = responseText.trim() || 'Unknown error';
          // Avoid echoing raw HTML error pages into the toast.
          const safeReason = fallbackReason.length > 500
            ? `${fallbackReason.slice(0, 500)}…`
            : fallbackReason;
          throw new Error(`HTTP ${res.status}: ${responseData.reason || safeReason}`);
        }

        const newInvoice = responseData.pr;
        if (!newInvoice || typeof newInvoice !== 'string') {
          throw new Error('Lightning service did not return a valid invoice');
        }

        // Get the current active NWC connection dynamically
        const currentNWCConnection = getActiveConnection();

        // Try NWC first if available and properly connected
        if (currentNWCConnection && currentNWCConnection.connectionString && currentNWCConnection.isConnected) {
          try {
            await sendPayment(currentNWCConnection, newInvoice);

            // Clear states immediately on success
            setIsZapping(false);
            setInvoice(null);
            notificationSuccess();

            // Invalidate zap queries to refresh counts
            queryClient.invalidateQueries({ queryKey: ['zaps'] });

            if (onZapSuccess) {
              // Consumer (e.g. ZapDialog) owns the success UI — skip the
              // toast so we don't double up with their celebration screen.
              onZapSuccess({ amountSats: amount });
            } else {
              toast({
                title: 'Zap successful!',
                description: `You sent ${amount} sats via NWC to the author.`,
              });
            }
            return;
          } catch (nwcError) {
            const rawMessage = nwcError instanceof Error ? nwcError.message : 'Unknown NWC error';
            // Log a redacted version of the error for support; never show the
            // raw provider message to the user because it may contain invoice
            // hints, wallet metadata, or a leaked connection URI.
            console.error('NWC payment failed, falling back:', redactSecrets(rawMessage));

            toast({
              title: 'NWC payment failed',
              description: 'Falling back to other payment methods...',
              variant: 'destructive',
            });
          }
        }

        if (webln) { // Try WebLN next
          try {
            // For native WebLN, we may need to enable it first
            let webLnProvider = webln;
            if (webln.enable && typeof webln.enable === 'function') {
              const enabledProvider = await webln.enable();
              // Some implementations return the provider, others return void
              // Cast to WebLNProvider to handle both cases
              const provider = enabledProvider as WebLNProvider | undefined;
              if (provider) {
                webLnProvider = provider;
              }
            }

            await webLnProvider.sendPayment(newInvoice);

            // Clear states immediately on success
            setIsZapping(false);
            setInvoice(null);
            notificationSuccess();

            // Invalidate zap queries to refresh counts
            queryClient.invalidateQueries({ queryKey: ['zaps'] });

            if (onZapSuccess) {
              onZapSuccess({ amountSats: amount });
            } else {
              toast({
                title: 'Zap successful!',
                description: `You sent ${amount} sats to the author.`,
              });
            }
          } catch (weblnError) {
            const rawMessage = weblnError instanceof Error ? weblnError.message : 'Unknown WebLN error';
            console.error('WebLN payment failed, falling back:', redactSecrets(rawMessage));

            toast({
              title: 'WebLN payment failed',
              description: 'Falling back to other payment methods...',
              variant: 'destructive',
            });

            setInvoice(newInvoice);
            setIsZapping(false);
          }
        } else { // Default - show QR code and manual Lightning URI
          setInvoice(newInvoice);
          setIsZapping(false);
        }
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Zap error:', redactSecrets(rawMessage));
        toast({
          title: 'Zap failed',
          description: 'Could not complete the zap. Please try again.',
          variant: 'destructive',
        });
        setIsZapping(false);
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Zap error:', redactSecrets(rawMessage));
      toast({
        title: 'Zap failed',
        description: 'Could not complete the zap. Please try again.',
        variant: 'destructive',
      });
      setIsZapping(false);
    } finally {
      zapInFlightRef.current = false;
    }
  };

  const resetInvoice = useCallback(() => {
    setInvoice(null);
  }, []);

  return {
    zap,
    isZapping,
    invoice,
    setInvoice,
    resetInvoice,
  };
}
