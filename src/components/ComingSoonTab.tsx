import { Construction } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface ComingSoonTabProps {
  title: string;
  description?: string;
}

export function ComingSoonTab({ title, description }: ComingSoonTabProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 px-8 text-center">
        <Construction className="size-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          {description ?? `${title} wallet support is coming soon.`}
        </p>
      </CardContent>
    </Card>
  );
}
