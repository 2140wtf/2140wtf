import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, User } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuthor } from '@/hooks/useAuthor';
import { getAvatarShape } from '@/lib/avatarShape';
import { cn } from '@/lib/utils';

/** The canonical 2140.wtf Nostr account. */
const TWO140_NPUB = 'npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j';

interface SupportContactCardProps {
  className?: string;
}

/**
 * Help-page support card pointing users to the 2140.wtf profile and DM inbox.
 */
export function SupportContactCard({ className }: SupportContactCardProps) {
  const pubkey = useMemo(() => {
    try {
      const decoded = nip19.decode(TWO140_NPUB);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {
      // fall through
    }
    return '';
  }, []);

  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? metadata?.display_name ?? '2140.wtf';
  const shape = getAvatarShape(metadata);

  return (
    <div className={cn('rounded-2xl border border-primary/20 bg-primary/5 overflow-hidden', className)}>
      <div className="px-5 pt-5 pb-4 space-y-4">
        <div className="flex items-start gap-3">
          <Avatar shape={shape} className="size-12 ring-2 ring-background shrink-0">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="bg-primary/20 text-primary text-sm">
              {displayName[0]?.toUpperCase() ?? '?'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-snug">Need help?</h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Reach out to the 2140.wtf team. We’re real people building this platform and happy to help.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 gap-2" asChild>
            <Link to={`/${TWO140_NPUB}`}>
              <User className="size-4" />
              Visit profile
            </Link>
          </Button>
          <Button className="flex-1 gap-2" asChild>
            <Link to={`/messages/${TWO140_NPUB}`}>
              <MessageCircle className="size-4" />
              Send DM
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
