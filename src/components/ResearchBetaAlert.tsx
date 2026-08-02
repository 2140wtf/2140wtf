import { Info } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export function ResearchBetaAlert({ className }: { className?: string }) {
  return (
    <Alert className={cn('border-amber-500/70 bg-card text-foreground [&>svg]:text-amber-500', className)}>
      <Info className="size-4" />
      <AlertTitle className="text-foreground">Active research projects — BETA</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        2140.wtf is an active research project in beta. Use all technology at your own risk and do not use large amounts of money.
      </AlertDescription>
    </Alert>
  );
}
