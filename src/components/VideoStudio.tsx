import React, { useRef } from 'react';
import { Save, Sparkles } from 'lucide-react';
import type { VideoTab } from '../types';

interface VideoStudioProps {
  tab: VideoTab;
  onSendFrameToStudio: (title: string, dataUrl: string) => void;
  onToast: (msg: string) => void;
}

export const VideoStudio: React.FC<VideoStudioProps> = ({
  tab,
  onSendFrameToStudio,
  onToast,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleCaptureFrame = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth;
    canvas.height = vid.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    onSendFrameToStudio(
      `${tab.title.replace(/\.[^.]+$/, '')}_Frame_${Math.round(vid.currentTime)}s.png`,
      dataUrl
    );
  };

  const handleSaveVideo = async () => {
    const isMp4 = tab.mimeType.includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const res = await window.electronAPI.saveBinary({
      defaultPath: `${tab.title.replace(/\.[^.]+$/, '')}.${ext}`,
      filters: [{ name: isMp4 ? 'MP4-Video' : 'WebM-Video', extensions: [ext] }],
      data: tab.bytes,
    });
    if (!res.canceled) {
      onToast('Bildschirmvideo gespeichert.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="toolbar">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Bildschirmvideo: {tab.title}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-success"
            onClick={handleCaptureFrame}
            title="Aktuelles Videobild ins KI-Markierungsstudio übernehmen"
          >
            <Sparkles size={15} /> Einzelbild für KI markieren
          </button>
          <button className="btn btn-primary" onClick={handleSaveVideo}>
            <Save size={15} /> Video speichern
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-app)',
          minHeight: 0,
        }}
      >
        <video
          ref={videoRef}
          src={tab.blobUrl}
          controls
          autoPlay
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            background: '#000',
          }}
        />
      </div>
    </div>
  );
};
