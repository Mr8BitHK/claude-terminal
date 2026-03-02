import { useEffect, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';

interface UpdateInfo {
  version: string;
  url: string;
}

export default function UpdateButton() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    window.claudeTerminal.getUpdateInfo().then((info) => {
      if (info) setUpdate(info);
    });
    return window.claudeTerminal.onUpdateAvailable(setUpdate);
  }, []);

  if (!update) return null;

  return (
    <button
      className="text-[#569cd6] hover:text-[#79b8f8] p-1 flex items-center animate-pulse"
      onClick={() => window.claudeTerminal.openExternal(update.url)}
      title={`Update available: v${update.version}`}
    >
      <ArrowDownToLine size={16} />
    </button>
  );
}
