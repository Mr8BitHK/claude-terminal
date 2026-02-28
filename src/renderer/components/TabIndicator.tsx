import { Loader2, CheckCircle2, MessageCircle } from 'lucide-react';
import type { TabStatus } from '../../shared/types';

const ICON_SIZE = 12;

interface TabIndicatorProps {
  status: TabStatus;
}

export default function TabIndicator({ status }: TabIndicatorProps) {
  switch (status) {
    case 'working':
      return (
        <span className="tab-indicator tab-indicator-spin">
          <Loader2 size={ICON_SIZE} />
        </span>
      );
    case 'idle':
      return (
        <span className="tab-indicator">
          <CheckCircle2 size={ICON_SIZE} />
        </span>
      );
    case 'requires_response':
      return (
        <span className="tab-indicator tab-indicator-pulse">
          <MessageCircle size={ICON_SIZE} />
        </span>
      );
    default:
      return null;
  }
}
