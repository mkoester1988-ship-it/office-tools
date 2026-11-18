import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCopy,
  Crop,
  EyeOff,
  Hand,
  Hash,
  Maximize2,
  MessageSquarePlus,
  Pencil,
  Save,
  ScanText,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Annotation, AnnotationTool, ImageTab } from '../types';
import { isElectron, saveBytesBrowserFallback, uploadToPc } from '../utils/platformBridge';

interface ImageStudioProps {
  tab: ImageTab;
  onUpdateTab: (updater: (prev: ImageTab) => ImageTab) => void;
  onNavigateSibling: (tabId: string, filePath: string) => void;
  onToast: (msg: string) => void;
}

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#06b6d4', '#ec4899', '#ffffff'];

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  baseImg: HTMLImageElement
): void {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const left = Math.min(ann.x1, ann.x2);
  const top = Math.min(ann.y1, ann.y2);
  const w = Math.abs(ann.x2 - ann.x1);
  const h = Math.abs(ann.y2 - ann.y1);

  if (ann.tool === 'rect') {
    ctx.strokeRect(ann.x1, ann.y1, ann.x2 - ann.x1, ann.y2 - ann.y1);
  } else if (ann.tool === 'circle') {
    ctx.beginPath();
    ctx.ellipse(left + w / 2, top + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (ann.tool === 'arrow') {
    const headLen = Math.max(14, ann.strokeWidth * 4.5);
    const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
    ctx.beginPath();
    ctx.moveTo(ann.x1, ann.y1);
    ctx.lineTo(ann.x2, ann.y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ann.x2, ann.y2);
    ctx.lineTo(
      ann.x2 - headLen * Math.cos(angle - Math.PI / 6),
      ann.y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      ann.x2 - headLen * Math.cos(angle + Math.PI / 6),
      ann.y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  } else if (ann.tool === 'freehand' && ann.points && ann.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(ann.points[0].x, ann.points[0].y);
    for (let i = 1; i < ann.points.length; i++) {
      ctx.lineTo(ann.points[i].x, ann.points[i].y);
    }
    ctx.stroke();
  } else if (ann.tool === 'badge') {
    const r = Math.max(16, ann.strokeWidth * 4);
    ctx.beginPath();
    ctx.arc(ann.x1, ann.y1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.round(r * 1.15)}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ann.badgeNumber ?? 1), ann.x1, ann.y1 + 1);
  } else if (ann.tool === 'text' && ann.text) {
    const fontSize = Math.max(18, ann.strokeWidth * 5);
    ctx.font = `bold ${fontSize}px Segoe UI, sans-serif`;
    const metrics = ctx.measureText(ann.text);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(ann.x1 - 6, ann.y1 - fontSize, metrics.width + 12, fontSize + 10);
    ctx.fillStyle = ann.color;
    ctx.fillText(ann.text, ann.x1, ann.y1);
  } else if (ann.tool === 'callout' && ann.text) {
    const fontSize = Math.max(16, ann.strokeWidth * 4.2);
    ctx.font = `600 ${fontSize}px Segoe UI, sans-serif`;
    const lines = ann.text.split('\n');
    const padX = 14;
    const padY = 10;
    const lineH = fontSize * 1.28;
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width), 80);
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lineH + padY * 2;
    const bx = ann.x1;
    const by = ann.y1;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = ann.color;
    ctx.lineWidth = Math.max(2, ann.strokeWidth * 0.75);
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textBaseline = 'top';
    lines.forEach((line, idx) => {
      ctx.fillText(line, bx + padX, by + padY + idx * lineH);
    });
  } else if (ann.tool === 'blur' && w > 2 && h > 2) {
    // Pixelate region cleanly
    const pixelSize = Math.max(8, Math.round(Math.min(w, h) / 8));
    const smallW = Math.max(1, Math.floor(w / pixelSize));
    const smallH = Math.max(1, Math.floor(h / pixelSize));
    const tmp = document.createElement('canvas');
    tmp.width = smallW;
    tmp.height = smallH;
    const tCtx = tmp.getContext('2d');
    if (tCtx) {
      tCtx.drawImage(baseImg, left, top, w, h, 0, 0, smallW, smallH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, smallW, smallH, left, top, w, h);
    }
  }

  ctx.restore();
}

export const ImageStudio: React.FC<ImageStudioProps> = ({
  tab,
  onUpdateTab,
  onNavigateSibling,
  onToast,
}) => {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draftAnn, setDraftAnn] = useState<Annotation | null>(null);
  const [cropRect, setCropRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [aiComment, setAiComment] = useState('');
  const [inlineTextEditor, setInlineTextEditor] = useState<{
    tool: 'text' | 'callout';
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    value: string;
  } | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const fitImageToContainer = (img: HTMLImageElement) => {
    const el = containerRef.current;
    if (!el) return;
    const pad = 48;
    const scaleX = (el.clientWidth - pad) / img.naturalWidth;
    const scaleY = (el.clientHeight - pad) / img.naturalHeight;
    const fitted = Math.min(1, Math.max(0.1, Math.min(scaleX, scaleY)));
    setZoom(fitted);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setAnnotations([]);
      setDraftAnn(null);
      setCropRect(null);
      fitImageToContainer(img);
    };
    img.src = tab.dataUrl;
  }, [tab.dataUrl]);

  // Redraw canvas whenever image, annotations, or draft changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = zoom < 2.5;
    ctx.drawImage(imgEl, 0, 0);

    for (const ann of annotations) {
      drawAnnotation(ctx, ann, imgEl);
    }
    if (draftAnn) {
      drawAnnotation(ctx, draftAnn, imgEl);
    }
    if (cropRect) {
      const left = Math.min(cropRect.x1, cropRect.x2);
      const top = Math.min(cropRect.y1, cropRect.y2);
      const w = Math.abs(cropRect.x2 - cropRect.x1);
      const h = Math.abs(cropRect.y2 - cropRect.y1);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(left, top, w, h);
      ctx.drawImage(imgEl, left, top, w, h, left, top, w, h);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = Math.max(2, 3 / zoom);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(left, top, w, h);
      ctx.restore();
    }
  }, [imgEl, annotations, draftAnn, cropRect, zoom]);

  const copyToClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    if (isElectron()) {
      await window.electronAPI.writeClipboardImage(dataUrl);
      onToast('Bild mit KI-Markierungen in Zwischenablage kopiert (Strg+V bereit).');
    } else {
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        onToast('Bild in Zwischenablage kopiert.');
      } catch {
        onToast('Zwischenablage wird auf diesem Gerät nicht unterstützt — nutze Speichern.');
      }
    }
  };

  const savePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const defaultName = tab.title.replace(/\.[^.]+$/, '') + '_markiert.png';
    if (!isElectron()) {
      saveBytesBrowserFallback(defaultName, bin, 'image/png');
      onToast('Bild gespeichert.');
      return;
    }
    const res = await window.electronAPI.saveBinary({
      defaultPath: defaultName,
      filters: [{ name: 'PNG-Bild', extensions: ['png'] }],
      data: bin,
    });
    if (!res.canceled) {
      onToast('Markiertes Bild gespeichert.');
    }
  };

  // Keyboard shortcuts (Ctrl+C copy, Ctrl+Z undo, Left/Right sibling browse)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyToClipboard();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setAnnotations((prev) => prev.slice(0, -1));
      } else if (tool === 'pan' && e.key === 'ArrowRight' && tab.filePath) {
        const idx = tab.siblingPaths.indexOf(tab.filePath);
        if (idx >= 0 && idx < tab.siblingPaths.length - 1) {
          onNavigateSibling(tab.id, tab.siblingPaths[idx + 1]);
        }
      } else if (tool === 'pan' && e.key === 'ArrowLeft' && tab.filePath) {
        const idx = tab.siblingPaths.indexOf(tab.filePath);
        if (idx > 0) {
          onNavigateSibling(tab.id, tab.siblingPaths[idx - 1]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, tab.filePath, tab.siblingPaths, annotations]);

  const toImageCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'pan' || e.button === 1) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    const pt = toImageCoords(e);
    if (tool === 'badge') {
      const nextNum = annotations.filter((a) => a.tool === 'badge').length + 1;
      setAnnotations((prev) => [
        ...prev,
        {
          id: `ann_${Date.now()}`,
          tool: 'badge',
          color,
          strokeWidth,
          x1: pt.x,
          y1: pt.y,
          x2: pt.x,
          y2: pt.y,
          badgeNumber: nextNum,
        },
      ]);
      return;
    }

    if (tool === 'text' || tool === 'callout') {
      const canvasRect = canvasRef.current!.getBoundingClientRect();
      const contRect = containerRef.current!.getBoundingClientRect();
      setInlineTextEditor({
        tool,
        x: pt.x,
        y: pt.y,
        screenX: e.clientX - contRect.left,
        screenY: e.clientY - contRect.top,
        value: '',
      });
      void canvasRect;
      return;
    }

    if (tool === 'crop') {
      setCropRect({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      return;
    }

    setDraftAnn({
      id: `ann_${Date.now()}`,
      tool,
      color,
      strokeWidth,
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
      points: tool === 'freehand' ? [pt] : undefined,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      });
      return;
    }

    const pt = toImageCoords(e);
    if (cropRect) {
      setCropRect((prev) => (prev ? { ...prev, x2: pt.x, y2: pt.y } : null));
      return;
    }
    if (!draftAnn) return;

    setDraftAnn((prev) => {
      if (!prev) return null;
      if (prev.tool === 'freehand') {
        return { ...prev, x2: pt.x, y2: pt.y, points: [...(prev.points ?? []), pt] };
      }
      return { ...prev, x2: pt.x, y2: pt.y };
    });
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    if (cropRect && imgEl) {
      const left = Math.max(0, Math.round(Math.min(cropRect.x1, cropRect.x2)));
      const top = Math.max(0, Math.round(Math.min(cropRect.y1, cropRect.y2)));
      const w = Math.round(Math.abs(cropRect.x2 - cropRect.x1));
      const h = Math.round(Math.abs(cropRect.y2 - cropRect.y1));
      setCropRect(null);
      if (w > 12 && h > 12) {
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const tCtx = tmp.getContext('2d');
        if (tCtx && canvasRef.current) {
          tCtx.drawImage(canvasRef.current, left, top, w, h, 0, 0, w, h);
          const croppedUrl = tmp.toDataURL('image/png');
          onUpdateTab((prev) => ({ ...prev, dataUrl: croppedUrl }));
          setTool('arrow');
          onToast('Ausschnitt zugeschnitten.');
        }
      }
      return;
    }
    if (draftAnn) {
      setAnnotations((prev) => [...prev, draftAnn]);
      setDraftAnn(null);
    }
  };

  const currentIdx = tab.filePath ? tab.siblingPaths.indexOf(tab.filePath) : -1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Top Studio Toolbar */}
      <div className="toolbar">
        {tab.siblingPaths.length > 1 && currentIdx >= 0 && (
          <div className="toolbar-group">
            <button
              className="btn"
              disabled={currentIdx <= 0}
              onClick={() => onNavigateSibling(tab.id, tab.siblingPaths[currentIdx - 1])}
              title="Vorheriges Bild im Ordner"
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {currentIdx + 1} / {tab.siblingPaths.length}
            </span>
            <button
              className="btn"
              disabled={currentIdx >= tab.siblingPaths.length - 1}
              onClick={() => onNavigateSibling(tab.id, tab.siblingPaths[currentIdx + 1])}
              title="Nächstes Bild im Ordner"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="toolbar-group">
          <button
            className="btn"
            onClick={() => setZoom((z) => Math.max(0.1, +(z * 0.8).toFixed(2)))}
          >
            <ZoomOut size={15} />
          </button>
          <span style={{ fontSize: 12, minWidth: 46, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="btn"
            onClick={() => setZoom((z) => Math.min(16, +(z * 1.25).toFixed(2)))}
          >
            <ZoomIn size={15} />
          </button>
          <button className="btn" onClick={() => setZoom(1)} title="1:1 Pixel">
            1:1
          </button>
          <button
            className="btn"
            onClick={() => imgEl && fitImageToContainer(imgEl)}
            title="An Fenster anpassen"
          >
            <Maximize2 size={14} /> Einpassen
          </button>
        </div>

        {/* KI Annotation Tools */}
        <div className="toolbar-group">
          <button
            className={`btn ${tool === 'pan' ? 'active' : ''}`}
            onClick={() => setTool('pan')}
            title="Verschieben / Bild blättern"
          >
            <Hand size={15} />
          </button>
          <button
            className={`btn ${tool === 'arrow' ? 'active' : ''}`}
            onClick={() => setTool('arrow')}
            title="Pfeil"
          >
            <ArrowUpRight size={15} />
          </button>
          <button
            className={`btn ${tool === 'rect' ? 'active' : ''}`}
            onClick={() => setTool('rect')}
            title="Rechteck"
          >
            <Square size={15} />
          </button>
          <button
            className={`btn ${tool === 'circle' ? 'active' : ''}`}
            onClick={() => setTool('circle')}
            title="Kreis / Ellipse"
          >
            <Circle size={15} />
          </button>
          <button
            className={`btn ${tool === 'freehand' ? 'active' : ''}`}
            onClick={() => setTool('freehand')}
            title="Freihand-Markierung"
          >
            <Pencil size={15} />
          </button>
          <button
            className={`btn ${tool === 'badge' ? 'active' : ''}`}
            onClick={() => setTool('badge')}
            title="Nummerierter Marker (1, 2, 3...)"
          >
            <Hash size={15} />
          </button>
          <button
            className={`btn ${tool === 'text' ? 'active' : ''}`}
            onClick={() => setTool('text')}
            title="Text-Hinweis"
          >
            <Type size={15} />
          </button>
          <button
            className={`btn ${tool === 'callout' ? 'active' : ''}`}
            onClick={() => setTool('callout')}
            title="Kommentar-Box direkt aufs Bild setzen"
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            className={`btn ${tool === 'blur' ? 'active' : ''}`}
            onClick={() => setTool('blur')}
            title="Bereich verpixeln / zensieren"
          >
            <EyeOff size={15} />
          </button>
          <button
            className={`btn ${tool === 'crop' ? 'active' : ''}`}
            onClick={() => setTool('crop')}
            title="Ausschnitt zuschneiden"
          >
            <Crop size={15} />
          </button>
        </div>

        {/* Color & Stroke */}
        <div className="toolbar-group">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: c,
                border: color === c ? '2px solid #fff' : '1px solid var(--border-strong)',
                cursor: 'pointer',
              }}
              title="Markierungsfarbe"
            />
          ))}
          <select
            className="input-compact"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            title="Strichstärke"
          >
            <option value={2}>Dünn</option>
            <option value={4}>Mittel</option>
            <option value={8}>Dick</option>
          </select>
        </div>

        <div className="toolbar-group">
          <button
            className="btn"
            disabled={annotations.length === 0}
            onClick={() => setAnnotations((prev) => prev.slice(0, -1))}
            title="Letzte Markierung rückgängig (Strg+Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="btn btn-danger-ghost"
            disabled={annotations.length === 0}
            onClick={() => setAnnotations([])}
            title="Alle Markierungen entfernen"
          >
            <Trash2 size={15} />
          </button>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {isElectron() && (
            <button
              className={`btn ${showAiPanel ? 'active' : ''}`}
              onClick={async () => {
                setShowAiPanel(true);
                if (!ocrText && canvasRef.current) {
                  setOcrLoading(true);
                  const res = await window.electronAPI.extractOcrText(
                    canvasRef.current.toDataURL('image/png')
                  );
                  setOcrLoading(false);
                  setOcrText(res.text || '');
                  if (res.text) {
                    onToast('Text aus Bild ausgelesen.');
                  } else {
                    onToast('Kein Text erkannt.');
                  }
                }
              }}
              title="Text aus dem Bild/Screenshot auslesen (Windows OCR) & KI-Kommentare öffnen"
            >
              <ScanText size={15} /> Text auslesen / KI-Notiz
            </button>
          )}
          {!isElectron() && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!canvasRef.current) return;
                const dataUrl = canvasRef.current.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
                const name = tab.title.replace(/\.[^.]+$/, '') + '_markiert.png';
                const res = await uploadToPc(name, bin);
                onToast(res.ok ? `Auf PC gespeichert: ${res.savedName}` : res.error || 'Fehler');
              }}
            >
              Auf PC speichern
            </button>
          )}
          <button
            className="btn btn-success"
            onClick={copyToClipboard}
            title="Bild inklusive Markierungen direkt in die Zwischenablage kopieren (Strg+C)"
          >
            <ClipboardCopy size={15} /> Für KI kopieren (Strg+C)
          </button>
          <button className="btn btn-primary" onClick={savePng}>
            <Save size={15} /> Speichern
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Image Canvas Viewport */}
      <div
        ref={containerRef}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          setZoom((z) => Math.min(16, Math.max(0.1, +(z * factor).toFixed(3))));
        }}
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at center, rgba(255,255,255,0.03) 0%, transparent 70%)',
          position: 'relative',
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            cursor: tool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair',
            boxShadow: 'var(--shadow)',
          }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
              width: imgEl ? imgEl.naturalWidth * zoom : undefined,
              height: imgEl ? imgEl.naturalHeight * zoom : undefined,
              display: 'block',
              imageRendering: zoom >= 2.5 ? 'pixelated' : 'auto',
            }}
          />
        </div>

        {inlineTextEditor && (
          <div
            style={{
              position: 'absolute',
              left: Math.max(12, inlineTextEditor.screenX),
              top: Math.max(12, inlineTextEditor.screenY),
              zIndex: 50,
              background: 'var(--bg-toolbar)',
              border: `2px solid ${color}`,
              borderRadius: 10,
              padding: 8,
              boxShadow: 'var(--shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 230,
            }}
          >
            <textarea
              autoFocus
              rows={3}
              className="input-compact"
              style={{ width: '100%', resize: 'both', fontFamily: 'inherit' }}
              placeholder={
                inlineTextEditor.tool === 'callout'
                  ? 'Kommentar eingeben (Enter = Fertig, Shift+Enter = Umbruch)...'
                  : 'Text eingeben (Enter = Fertig)...'
              }
              value={inlineTextEditor.value}
              onChange={(e) =>
                setInlineTextEditor((prev) =>
                  prev ? { ...prev, value: e.target.value } : null
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setInlineTextEditor(null);
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const txt = inlineTextEditor.value.trim();
                  if (txt) {
                    setAnnotations((prev) => [
                      ...prev,
                      {
                        id: `ann_${Date.now()}`,
                        tool: inlineTextEditor.tool,
                        color,
                        strokeWidth,
                        x1: inlineTextEditor.x,
                        y1: inlineTextEditor.y,
                        x2: inlineTextEditor.x,
                        y2: inlineTextEditor.y,
                        text: txt,
                      },
                    ]);
                  }
                  setInlineTextEditor(null);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button
                className="btn"
                style={{ padding: '3px 8px', fontSize: 11.5 }}
                onClick={() => setInlineTextEditor(null)}
              >
                Abbrechen
              </button>
              <button
                className="btn btn-primary"
                style={{ padding: '3px 10px', fontSize: 11.5 }}
                onClick={() => {
                  const txt = inlineTextEditor.value.trim();
                  if (txt) {
                    setAnnotations((prev) => [
                      ...prev,
                      {
                        id: `ann_${Date.now()}`,
                        tool: inlineTextEditor.tool,
                        color,
                        strokeWidth,
                        x1: inlineTextEditor.x,
                        y1: inlineTextEditor.y,
                        x2: inlineTextEditor.x,
                        y2: inlineTextEditor.y,
                        text: txt,
                      },
                    ]);
                  }
                  setInlineTextEditor(null);
                }}
              >
                Einfügen
              </button>
            </div>
          </div>
        )}
      </div>

      {showAiPanel && (
        <aside
          style={{
            width: 310,
            background: 'var(--bg-panel)',
            borderLeft: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            padding: 12,
            gap: 10,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 13 }}>KI-Text & Schnell-Kommentare</strong>
            <button className="btn" style={{ padding: '2px 6px' }} onClick={() => setShowAiPanel(false)}>
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ausgelesener Text (OCR)</span>
              <button
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11.5 }}
                onClick={async () => {
                  if (!canvasRef.current) return;
                  setOcrLoading(true);
                  const res = await window.electronAPI.extractOcrText(
                    canvasRef.current.toDataURL('image/png')
                  );
                  setOcrLoading(false);
                  setOcrText(res.text || '');
                }}
              >
                {ocrLoading ? 'Liest...' : 'Neu auslesen'}
              </button>
            </div>
            <textarea
              className="input-compact"
              rows={7}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              value={ocrLoading ? 'Text wird ausgelesen...' : ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              placeholder="Hier erscheint der erkannte Text aus dem Screenshot..."
            />
            <button
              className="btn btn-primary"
              disabled={!ocrText.trim()}
              onClick={async () => {
                await window.electronAPI.writeClipboardText(ocrText);
                onToast('Ausgelesener Text in Zwischenablage kopiert.');
              }}
            >
              <ClipboardCopy size={14} /> OCR-Text kopieren
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Schnell-Kommentar für KI
            </span>
            <textarea
              className="input-compact"
              rows={5}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              value={aiComment}
              onChange={(e) => setAiComment(e.target.value)}
              placeholder="z. B. Punkt 1: Button größer machen, Punkt 2: Text korrigieren..."
            />
            <button
              className="btn btn-success"
              disabled={!aiComment.trim() && !ocrText.trim()}
              onClick={async () => {
                const combined = [
                  aiComment.trim(),
                  ocrText.trim() ? `---\nAusgelesener Text:\n${ocrText.trim()}` : '',
                ]
                  .filter(Boolean)
                  .join('\n\n');
                await window.electronAPI.writeClipboardText(combined);
                onToast('Kommentar + Text in Zwischenablage kopiert.');
              }}
            >
              <ClipboardCopy size={14} /> Kommentar & Text kopieren
            </button>
          </div>
        </aside>
      )}
      </div>
    </div>
  );
};
