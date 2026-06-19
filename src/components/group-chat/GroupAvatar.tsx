import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-cyan-500 to-blue-600',
  'from-fuchsia-500 to-rose-500',
  'from-lime-500 to-emerald-600',
];

function hashGroupId(groupId: string): number {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash << 5) - hash + groupId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

interface GroupAvatarProps {
  groupId: string;
  name: string;
  className?: string;
}

export function GroupAvatar({ groupId, name, className }: GroupAvatarProps) {
  const gradient = GRADIENTS[hashGroupId(groupId) % GRADIENTS.length];
  const initial = name.trim()[0]?.toUpperCase() || '#';

  return (
    <Avatar className={cn('bg-gradient-to-br text-white', gradient, className)}>
      <AvatarFallback className="bg-transparent text-white font-semibold">
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
