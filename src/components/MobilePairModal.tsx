import React, { useEffect, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { getPcSyncPairing, setPcSyncPairing } from '../utils/platformBridge';

interface MobilePairModalProps {
  onClose: () => void;
  onPaired: () => void;
  onToast: (msg: string) => void;
}

export const MobilePairModal: React.FC<MobilePairModalProps> = ({
  onClose,
  onPaired,
  onToast,
}) => {
  const [input, setInput] = useState(() => {
    const cur = getPcSyncPairing();
    return cur ? `${cur.baseUrl}/?token=${cur.token}` : 'http://192.168.2.21:3847/?token=';
  });
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startQrScan = async () => {
    try {
      const Detector = (window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
        };
      }).BarcodeDetector;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);

      setTimeout(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!Detector) {
          onToast('QR-Scanner nicht unterstützt — bitte Sync-Link unten einfügen.');
          return;
        }
        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              const val = codes[0].rawValue;
              if (setPcSyncPairing(val)) {
                stopCamera();
                onToast('Per QR-Code mit PC verbunden!');
                onPaired();
                return;
              }
            }
          } catch {
            // ignore frame error
          }
          if (streamRef.current) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, 150);
    } catch {
      onToast('Kamera-Zugriff nicht möglich — bitte Sync-Link unten einfügen.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 14,
          padding: 18,
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>Mit PC koppeln</strong>
          <button
            className="btn"
            onClick={() => {
              stopCamera();
              onClose();
            }}
          >
            <X size={16} />
          </button>
        </div>

        {!scanning ? (
          <button className="btn btn-primary" style={{ justifyContent: 'center', padding: 11 }} onClick={startQrScan}>
            <QrCode size={17} /> QR-Code vom PC scannen (Kamera)
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 240 }}
            />
            <button className="btn" onClick={stopCamera}>
              Kamera schließen
            </button>
          </div>
        )}

        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Oder Sync-Link aus „Handy-Sync“ auf dem PC einfügen:
        </span>
        <input
          className="input-compact"
          style={{ width: '100%', padding: '8px 10px' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="http://192.168.2.21:3847/?token=..."
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              stopCamera();
              onClose();
            }}
          >
            Abbrechen
          </button>
          <button
            className="btn btn-success"
            onClick={() => {
              if (setPcSyncPairing(input)) {
                stopCamera();
                onToast('Mit PC gekoppelt!');
                onPaired();
              } else {
                onToast('Ungültiger Sync-Link (token=... fehlt).');
              }
            }}
          >
            Verbinden
          </button>
        </div>
      </div>
    </div>
  );
};
