import { Circle, Loader2, CheckCircle2, MessageCircle, TerminalSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TabStatus } from '../../shared/types';

const ICON_SIZE = 12;

interface TabIndicatorProps {
  status: TabStatus;
}

export default function TabIndicator({ status }: TabIndicatorProps) {
  switch (status) {
    case 'working':
      return (
        <span className={cn('inline-flex items-center [&_svg]:size-3 text-warning animate-spin')}>
          <Loader2 size={ICON_SIZE} />
        </span>
      );
    case 'idle':
      return (
        <span className={cn('inline-flex items-center [&_svg]:size-3 text-success')}>
          <CheckCircle2 size={ICON_SIZE} />
        </span>
      );
    case 'requires_response':
      return (
        <span className={cn('inline-flex items-center [&_svg]:size-3 text-attention animate-pulse')}>
          <MessageCircle size={ICON_SIZE} />
        </span>
      );
    case 'shell':
      return (
        <span className={cn('inline-flex items-center [&_svg]:size-3 text-[#569cd6]')}>
          <TerminalSquare size={ICON_SIZE} />
        </span>
      );
    case 'new':
      return (
        <span className={cn('inline-flex items-center [&_svg]:size-3')}>
          <Circle size={ICON_SIZE} />
        </span>
      );
  }
}
