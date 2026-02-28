import { useEffect, useRef, useState } from 'react';
import { Cloud } from 'lucide-react';
import type { RemoteAccessInfo } from '../../shared/types';

interface RemoteAccessButtonProps {
  remoteInfo: RemoteAccessInfo;
  onActivate: () => void;
  onDeactivate: () => void;
}

export default function RemoteAccessButton({ remoteInfo, onActivate, onDeactivate }: RemoteAccessButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Outside-click handler — same pattern as HamburgerMenu.tsx
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

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

  const btnClass = [
    'remote-access-btn',
    remoteInfo.status === 'active' ? 'remote-active' : '',
    remoteInfo.status === 'connecting' ? 'remote-connecting' : '',
  ].filter(Boolean).join(' ');

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max) + '\u2026' : s;

  return (
    <div className="remote-access-menu" ref={menuRef}>
      <button
        className={btnClass}
        onClick={() => setOpen(!open)}
        title="Remote access"
      >
        <Cloud size={16} />
      </button>
      {open && (
        <div className="remote-access-dropdown">
          <div className="remote-access-header">Remote Access</div>

          {remoteInfo.status === 'inactive' && (
            <>
              <p className="remote-access-desc">
                Share a secure tunnel URL so others can connect to this session from a browser.
              </p>
              <button className="remote-access-action" onClick={() => { onActivate(); }}>
                Activate
              </button>
            </>
          )}

          {remoteInfo.status === 'connecting' && (
            <p className="remote-access-desc">Connecting tunnel...</p>
          )}

          {remoteInfo.status === 'active' && remoteInfo.tunnelUrl && (
            <>
              <div className="remote-access-status">&#9679; Connected</div>

              {qrDataUrl && (
                <div className="remote-access-qr">
                  <img src={qrDataUrl} alt="QR code" width={180} height={180} />
                </div>
              )}

              <div className="remote-access-field">
                <span className="remote-access-label">URL</span>
                <span className="remote-access-value">{truncate(remoteInfo.tunnelUrl, 32)}</span>
                <button
                  className="remote-access-copy"
                  onClick={() => copyToClipboard(remoteInfo.tunnelUrl!, 'url')}
                >
                  {copiedField === 'url' ? 'Copied!' : 'Copy'}
                </button>
              </div>

              {remoteInfo.token && (
                <div className="remote-access-field">
                  <span className="remote-access-label">Code</span>
                  <span className="remote-access-value" style={{ letterSpacing: '0.15em', fontWeight: 600 }}>{remoteInfo.token}</span>
                  <button
                    className="remote-access-copy"
                    onClick={() => copyToClipboard(remoteInfo.token!, 'token')}
                  >
                    {copiedField === 'token' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}

              <button
                className="remote-access-action remote-deactivate"
                onClick={() => { onDeactivate(); }}
              >
                Deactivate
              </button>
            </>
          )}

          {remoteInfo.status === 'error' && (
            <>
              <p className="remote-access-error">{remoteInfo.error || 'An error occurred.'}</p>
              <button className="remote-access-action" onClick={() => { onActivate(); }}>
                Retry
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
