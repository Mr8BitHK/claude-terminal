import { useEffect, useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import type { RemoteAccessInfo } from '../../shared/types';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface RemoteAccessButtonProps {
  remoteInfo: RemoteAccessInfo;
  onActivate: () => void;
  onDeactivate: () => void;
}

export default function RemoteAccessButton({ remoteInfo, onActivate, onDeactivate }: RemoteAccessButtonProps) {
  const [open, setOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  // Clear activating state once the status progresses
  useEffect(() => {
    if (remoteInfo.status !== 'inactive') setActivating(false);
  }, [remoteInfo.status]);

  // Generate QR code when tunnel URL is available and dropdown is open
  useEffect(() => {
    if (!open || remoteInfo.status !== 'active' || !remoteInfo.tunnelUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    import('qrcode').then((QRCode) => {
      if (cancelled) return;
      QRCode.toDataURL(remoteInfo.tunnelUrl!, {
        width: 180,
        margin: 1,
        color: { dark: '#d4d4d4', light: '#1e1e1e' },
      }).then((url: string) => {
        if (!cancelled) setQrDataUrl(url);
      });
    });
    return () => { cancelled = true; };
  }, [open, remoteInfo.status, remoteInfo.tunnelUrl]);

  // Clear "Copied!" feedback after a short delay
  useEffect(() => {
    if (!copiedField) return;
    const timer = setTimeout(() => setCopiedField(null), 1500);
    return () => clearTimeout(timer);
  }, [copiedField]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max) + '\u2026' : s;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7',
            remoteInfo.status === 'active' && 'text-success',
            (remoteInfo.status === 'connecting' || remoteInfo.status === 'installing') && 'text-warning animate-pulse',
            remoteInfo.status === 'inactive' && 'text-muted-foreground hover:text-foreground',
            remoteInfo.status === 'error' && 'text-destructive',
          )}
          title="Remote access"
        >
          <Cloud size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[260px] p-3">
        <h3 className="text-sm font-semibold mb-2">Remote Access</h3>

        {remoteInfo.status === 'inactive' && (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Share a secure tunnel URL so others can connect to this session from a browser.
            </p>
            <Button
              className="w-full mt-2"
              disabled={activating}
              onClick={() => { setActivating(true); onActivate(); }}
            >
              {activating ? <><Loader2 size={14} className="animate-spin" /> Activating...</> : 'Activate'}
            </Button>
          </>
        )}

        {remoteInfo.status === 'installing' && (
          <div className="text-xs text-muted-foreground">
            <p>Installing cloudflared{remoteInfo.progress != null ? ` (${remoteInfo.progress}%)` : ''}...</p>
            <div className="h-1 bg-secondary rounded mt-1.5 overflow-hidden">
              <div
                className="h-full bg-primary rounded transition-[width]"
                style={{ width: `${remoteInfo.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {remoteInfo.status === 'connecting' && (
          <p className="text-xs text-muted-foreground">Connecting tunnel...</p>
        )}

        {remoteInfo.status === 'active' && remoteInfo.tunnelUrl && (
          <>
            <div className="text-xs text-success mb-2">&#9679; Connected</div>

            {qrDataUrl && (
              <div className="flex justify-center mb-2">
                <img src={qrDataUrl} alt="QR code" width={180} height={180} />
              </div>
            )}

            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] text-muted-foreground w-8">URL</span>
              <span className="text-xs flex-1 truncate">{truncate(remoteInfo.tunnelUrl, 32)}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={() => copyToClipboard(remoteInfo.tunnelUrl!, 'url')}
              >
                {copiedField === 'url' ? 'Copied!' : 'Copy'}
              </Button>
            </div>

            {remoteInfo.token && (
              <div className="flex items-center gap-1 mb-2">
                <span className="text-[10px] text-muted-foreground w-8">Code</span>
                <span className="text-xs flex-1 tracking-wider font-semibold">{remoteInfo.token}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[10px] px-1.5"
                  onClick={() => copyToClipboard(remoteInfo.token!, 'token')}
                >
                  {copiedField === 'token' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            )}

            <Button
              variant="secondary"
              className="w-full mt-2"
              onClick={() => { onDeactivate(); }}
            >
              Deactivate
            </Button>
          </>
        )}

        {remoteInfo.status === 'error' && (
          <>
            <p className="text-xs text-destructive mb-2">{remoteInfo.error || 'An error occurred.'}</p>
            <Button className="w-full" onClick={() => { onActivate(); }}>
              Retry
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
