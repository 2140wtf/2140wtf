import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';

import type { Webxdc as WebxdcAPI, SendingStatusUpdate, ReceivedStatusUpdate, RealtimeListener } from '@webxdc/types/webxdc';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { usePublishPreferences } from './usePublishPreferences';

/**
 * Creates a mini-app API instance backed by Nostr kind 4932 state update events.
 *
 * - `sendUpdate()` publishes a kind 4932 event with an `i` tag referencing the UUID.
 * - `setUpdateListener()` / `getAllUpdates()` query kind 4932 events with `#i` = UUID,
 *   ordered by `created_at`, and assign serial numbers.
 *
 * @param uuid - The mini-app session UUID from the `webxdc` property in the imeta tag.
 */
export function useWebxdc(uuid: string): WebxdcAPI<unknown> {
  const { nostr } = useNostr();
  const { user, metadata } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const queryClient = useQueryClient();

  // Ephemeral keypair generated once per mini-app session for logged-out users.
  // useState's lazy initializer avoids mutating a ref during render (a side-effect
  // that breaks in StrictMode / concurrent rendering) while keeping signer and
  // pubkey derived from the same secret key.
  const [{ signer: ephemeralSigner, pubkey: ephemeralPubkey }] = useState(() => {
    const secretKey = generateSecretKey();
    return {
      signer: new NSecSigner(secretKey),
      pubkey: getPublicKey(secretKey),
    };
  });

  // Track the update listener callback
  const listenerRef = useRef<((update: ReceivedStatusUpdate<unknown>) => void) | null>(null);
  const lastSerialRef = useRef(0);

  // Query all existing kind 4932 events for this UUID
  const { data: stateEvents } = useQuery({
    queryKey: ['webxdc-updates', uuid],
    queryFn: async () => {
      const events = await nostr.query([{
        kinds: [4932],
        '#i': [uuid],
        limit: 500,
      }]);
      // Sort by created_at ascending (oldest first) for serial assignment
      return events.sort((a, b) => a.created_at - b.created_at);
    },
    refetchInterval: 3000, // Poll for new updates every 3 seconds
  });

  // Convert events to ReceivedStatusUpdates with serial numbers
  const updates = useMemo((): ReceivedStatusUpdate<unknown>[] => {
    if (!stateEvents) return [];
    return stateEvents.map((event, index) => {
      const serial = index + 1;
      let payload: unknown;
      try {
        payload = JSON.parse(event.content);
      } catch {
        payload = event.content;
      }

      const info = event.tags.find(([n]) => n === 'info')?.[1];
      const document = event.tags.find(([n]) => n === 'document')?.[1];
      const summary = event.tags.find(([n]) => n === 'summary')?.[1];

      const update: ReceivedStatusUpdate<unknown> = {
        payload,
        serial,
        max_serial: stateEvents.length,
        ...(info && { info }),
        ...(document && { document }),
        ...(summary && { summary }),
      };
      return update;
    });
  }, [stateEvents]);

  // Deliver new updates to listener when data changes
  useEffect(() => {
    if (!listenerRef.current || !updates.length) return;
    const listener = listenerRef.current;
    const lastSerial = lastSerialRef.current;

    for (const update of updates) {
      if (update.serial > lastSerial) {
        listener(update);
        lastSerialRef.current = update.serial;
      }
    }
  }, [updates]);

  // Track whether a realtime channel is currently active
  const realtimeActiveRef = useRef(false);
  const realtimeAbortRef = useRef<AbortController | null>(null);

  // Clean up realtime subscription on unmount
  useEffect(() => {
    return () => {
      if (realtimeAbortRef.current) {
        realtimeAbortRef.current.abort();
        realtimeActiveRef.current = false;
      }
    };
  }, []);

  const activePubkey = user ? user.pubkey : ephemeralPubkey;

  const selfAddr = nip19.npubEncode(activePubkey);
  const selfName = metadata?.name || metadata?.display_name || nip19.npubEncode(activePubkey).slice(0, 12);

  // Publish a signed event using whichever signer is active (logged-in user or ephemeral key)
  const publishSigned = useCallback(async (template: Parameters<typeof ephemeralSigner.signEvent>[0]) => {
    if (user) {
      if (!isEnabled('webxdc')) throw new Error('Webxdc publishing is disabled. Turn it on in Settings → Privacy & Publishing.');
      // Logged-in path: delegate to useNostrPublish so the client tag is added
      return await publishEvent(template);
    } else {
      // Logged-out path: sign with the ephemeral key and publish directly
      const event = await ephemeralSigner.signEvent(template);
      return await nostr.event(event, { signal: AbortSignal.timeout(5000) });
    }
  }, [user, publishEvent, ephemeralSigner, nostr, isEnabled]);

  const sendUpdate = useCallback((update: SendingStatusUpdate<unknown>, _description: '') => {
    const tags: string[][] = [
      ['i', uuid],
      ['alt', 'Mini app update'],
    ];
    if (update.info) tags.push(['info', update.info]);
    if (update.document) tags.push(['document', update.document]);
    if (update.summary) tags.push(['summary', update.summary]);

    publishSigned({
      kind: 4932,
      content: JSON.stringify(update.payload),
      tags,
      created_at: Math.floor(Date.now() / 1000),
    }).then(() => {
      // Invalidate the query to pick up the new event
      queryClient.invalidateQueries({ queryKey: ['webxdc-updates', uuid] });
    }).catch((err) => {
      console.error('Failed to publish mini-app update:', err);
    });
  }, [uuid, publishSigned, queryClient]);

  const setUpdateListener = useCallback(async (
    cb: (update: ReceivedStatusUpdate<unknown>) => void,
    serial?: number,
  ): Promise<void> => {
    listenerRef.current = cb;
    lastSerialRef.current = serial ?? 0;

    // Deliver existing updates above the serial
    for (const update of updates) {
      if (update.serial > (serial ?? 0)) {
        cb(update);
        lastSerialRef.current = update.serial;
      }
    }
  }, [updates]);

  const getAllUpdates = useCallback(async (): Promise<ReceivedStatusUpdate<unknown>[]> => {
    return updates;
  }, [updates]);

  const sendToChat = useCallback(async (): Promise<void> => {
    // Not implemented for Nostr context
    throw new Error('sendToChat is not supported in Nostr');
  }, []);

  const importFiles = useCallback(async (): Promise<File[]> => {
    // Not implemented for Nostr context
    return [];
  }, []);

  const joinRealtimeChannel = useCallback((): RealtimeListener => {
    if (realtimeActiveRef.current) {
      throw new Error('Already joined a realtime channel. Call leave() first.');
    }

    realtimeActiveRef.current = true;
    const abortController = new AbortController();
    realtimeAbortRef.current = abortController;

    let realtimeListener: ((data: Uint8Array) => void) | null = null;

    // Subscribe to ephemeral kind 20932 events for this UUID
    const startSubscription = async () => {
      try {
        for await (const msg of nostr.req(
          [{ kinds: [20932], '#i': [uuid], since: Math.floor(Date.now() / 1000) }],
          { signal: abortController.signal },
        )) {
          if (msg[0] === 'EVENT') {
            const event = msg[2];
            // Don't echo back our own events
            if (event.pubkey === activePubkey) continue;
            if (!realtimeListener) continue;

            try {
              const binary = Uint8Array.from(atob(event.content), (c) => c.charCodeAt(0));
              realtimeListener(binary);
            } catch {
              // Ignore malformed content
            }
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // Subscription ended (abort or error)
      }
    };

    startSubscription();

    return {
      setListener(listener: (data: Uint8Array) => void) {
        realtimeListener = listener;
      },
      send(data: Uint8Array) {
        if (!realtimeActiveRef.current) return;
        if (data.length > 128_000) {
          throw new Error('Realtime payload exceeds 128,000 byte limit');
        }

        // Base64-encode the Uint8Array
        let binary = '';
        for (let i = 0; i < data.length; i++) {
          binary += String.fromCharCode(data[i]);
        }
        const base64 = btoa(binary);

        publishSigned({
          kind: 20932,
          content: base64,
          tags: [['i', uuid]],
          created_at: Math.floor(Date.now() / 1000),
        }).catch((err) => {
          console.error('Failed to publish mini-app realtime event:', err);
        });
      },
      leave() {
        realtimeActiveRef.current = false;
        abortController.abort();
        realtimeAbortRef.current = null;
      },
    };
  }, [uuid, nostr, activePubkey, publishSigned]);

  return useMemo((): WebxdcAPI<unknown> => ({
    selfAddr,
    selfName,
    sendUpdateInterval: 1000,
    sendUpdateMaxSize: 65536,
    sendUpdate,
    setUpdateListener,
    getAllUpdates,
    sendToChat,
    importFiles,
    joinRealtimeChannel,
  }), [selfAddr, selfName, sendUpdate, setUpdateListener, getAllUpdates, sendToChat, importFiles, joinRealtimeChannel]);
}
