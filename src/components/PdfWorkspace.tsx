import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Columns,
  FilePlus2,
  FolderOutput,
  Highlighter,
  Maximize2,
  PenTool,
  Printer,
  RotateCw,
  Save,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  PdfFormFieldValue,
  PdfHighlight,
  PdfPart,
  PdfSignaturePlacement,
  PdfSource,
  PdfTab,
  VirtualPage,
} from '../types';
import { SignatureModal } from './SignatureModal';
import {
  OutlineEntry,
  PART_COLORS,
  buildPdfFromPages,
  extractPdfPageAsDataUrl,
  getPdfJsDoc,
  loadPdfPageCount,
  pdfjsLib,
  readPdfFormFields,
  readPdfOutline,
} from '../utils/pdfOperations';
import {
  isElectron,
  pickLocalFilesWeb,
  saveBytesBrowserFallback,
  uploadToPc,
} from '../utils/platformBridge';

interface PdfWorkspaceProps {
  tab: PdfTab;
  onUpdateTab: (updater: (prev: PdfTab) => PdfTab) => void;
  onSendImageToStudio: (title: string, dataUrl: string) => void;
  onToast: (msg: string) => void;
}

interface PageCanvasProps {
  source: PdfSource;
  pageIndex0: number;
  scale: number;
  extraRotation: number;
  enableTextLayer?: boolean;
  className?: string;
}

const PageCanvas: React.FC<PageCanvasProps> = React.memo(({
  source,
  pageIndex0,
  scale,
  extraRotation,
  enableTextLayer = false,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textTask: { cancel?: () => void; render: () => Promise<void> } | null = null;

    (async () => {
      try {
        const doc = await getPdfJsDoc(source);
        if (cancelled) return;
        const page = await doc.getPage(pageIndex0 + 1);
        if (cancelled) return;

        const viewport = page.getViewport({
          scale,
          rotation: (page.rotate + extraRotation) % 360,
        });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        renderTask = page.render({ canvasContext: ctx, viewport }) as unknown as {
          cancel: () => void;
          promise: Promise<void>;
        };
        await renderTask.promise;

        if (enableTextLayer && textLayerRef.current && !cancelled) {
          const tlEl = textLayerRef.current;
          tlEl.innerHTML = '';
          tlEl.style.width = `${viewport.width}px`;
          tlEl.style.height = `${viewport.height}px`;
          const textContent = await page.getTextContent();
          if (cancelled) return;
          const TextLayerCtor = (pdfjsLib as unknown as {
            TextLayer?: new (params: {
              textContentSource: unknown;
              container: HTMLElement;
              viewport: unknown;
            }) => { render: () => Promise<void>; cancel?: () => void };
          }).TextLayer;
          if (TextLayerCtor) {
            textTask = new TextLayerCtor({
              textContentSource: textContent,
              container: tlEl,
              viewport,
            });
            await textTask.render();
          }
        }
      } catch {
        // Ignore cancelled renders
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask && typeof renderTask.cancel === 'function') {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
      if (textTask && typeof textTask.cancel === 'function') {
        try {
          textTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [source, pageIndex0, scale, extraRotation, enableTextLayer]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas ref={canvasRef} className={className} style={{ display: 'block' }} />
      {enableTextLayer && <div ref={textLayerRef} className="pdf-text-layer" />}
    </div>
  );
});

export const PdfWorkspace: React.FC<PdfWorkspaceProps> = ({
  tab,
  onUpdateTab,
  onSendImageToStudio,
  onToast,
}) => {
  const [zoom, setZoom] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 0.65 : 1.25
  );
  const [showSidebar, setShowSidebar] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [viewMode, setViewMode] = useState<'single' | 'scroll'>('scroll');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [sidebarTab, setSidebarTab] = useState<'pages' | 'parts' | 'outline' | 'form'>('pages');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingPartName, setEditingPartName] = useState('');
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [formFields, setFormFields] = useState<PdfFormFieldValue[]>([]);
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState('#fde047');
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [dragSigState, setDragSigState] = useState<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    shellW: number;
    shellH: number;
  } | null>(null);
  const [draftHighlight, setDraftHighlight] = useState<{
    pageId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef<number | null>(null);

  const activePage = tab.pages[tab.activePageIndex] ?? tab.pages[0];
  const activeSource = activePage
    ? tab.sources.find((s) => s.id === activePage.sourceId)
    : undefined;
  const partMap = new Map(tab.parts.map((p) => [p.id, p]));
  const highlights = tab.highlights ?? [];
  const signatures = tab.signatures ?? [];
  const formValues = tab.formValues ?? {};

  // Load outline & form fields for primary source
  useEffect(() => {
    const firstSource = tab.sources[0];
    if (!firstSource) return;
    readPdfOutline(firstSource).then(setOutline).catch(() => setOutline([]));
    readPdfFormFields(firstSource)
      .then((fields) => {
        setFormFields(fields);
        if (fields.length > 0 && !tab.formValues) {
          const initial: Record<string, string | boolean> = {};
          fields.forEach((f) => {
            initial[f.name] = f.value;
          });
          onUpdateTab((prev) => ({ ...prev, formValues: initial }));
        }
      })
      .catch(() => setFormFields([]));
  }, [tab.sources]);

  const goToPage = (index0: number) => {
    const clamped = Math.max(0, Math.min(tab.pages.length - 1, index0));
    onUpdateTab((prev) => ({ ...prev, activePageIndex: clamped }));
    if (viewMode === 'scroll') {
      const el = pageRefs.current.get(clamped);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleViewportScroll = () => {
    if (viewMode !== 'scroll' || !viewportRef.current) return;
    const vpTop = viewportRef.current.getBoundingClientRect().top;
    let closestIdx = tab.activePageIndex;
    let minDist = Infinity;
    pageRefs.current.forEach((el, idx) => {
      const dist = Math.abs(el.getBoundingClientRect().top - vpTop - 24);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });
    if (closestIdx !== tab.activePageIndex) {
      onUpdateTab((prev) => ({ ...prev, activePageIndex: closestIdx }));
    }
  };

  const toggleSelectPage = (pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const handleSaveSelectedPages = async () => {
    const picked = tab.pages.filter((p) => selectedPageIds.has(p.id));
    if (picked.length === 0) {
      onToast('Bitte zuerst mindestens eine Seite auswählen.');
      return;
    }
    const bytes = await buildPdfFromPages(tab.sources, picked, highlights, formValues, signatures);
    const baseName = tab.title.replace(/\.pdf$/i, '');
    if (!isElectron()) {
      saveBytesBrowserFallback(`${baseName}_Auswahl.pdf`, bytes, 'application/pdf');
      onToast(`${picked.length} ausgewählte Seiten gespeichert.`);
      return;
    }
    const res = await window.electronAPI.saveBinary({
      defaultPath: `${baseName}_Auswahl.pdf`,
      filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
      data: bytes,
    });
    if (!res.canceled) {
      onToast(`${picked.length} ausgewählte Seiten als PDF gespeichert.`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        showSignatureModal ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(tab.activePageIndex + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(tab.activePageIndex - 1);
      } else if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        setZoom((z) => Math.min(3.5, +(z + 0.15).toFixed(2)));
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab.activePageIndex, tab.pages.length, showSignatureModal]);

  const handleSplitAfterPage = (pageIdx0: number) => {
    if (pageIdx0 >= tab.pages.length - 1) return;
    onUpdateTab((prev) => {
      const currentPartId = prev.pages[pageIdx0].partId;
      const nextPagePartId = prev.pages[pageIdx0 + 1].partId;

      if (currentPartId !== nextPagePartId) {
        const mergedPages = prev.pages.map((p) =>
          p.partId === nextPagePartId ? { ...p, partId: currentPartId } : p
        );
        const usedIds = new Set(mergedPages.map((p) => p.partId));
        return {
          ...prev,
          pages: mergedPages,
          parts: prev.parts.filter((part) => usedIds.has(part.id)),
        };
      }

      const newPartId = `part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newPartNum = prev.parts.length + 1;
      const newPart: PdfPart = {
        id: newPartId,
        name: `${prev.title.replace(/\.pdf$/i, '')}_Part${newPartNum}`,
        color: PART_COLORS[(newPartNum - 1) % PART_COLORS.length],
      };

      const updatedPages: VirtualPage[] = prev.pages.map((p, idx) =>
        idx > pageIdx0 && p.partId === currentPartId ? { ...p, partId: newPartId } : p
      );

      const curPartIdx = prev.parts.findIndex((p) => p.id === currentPartId);
      const nextParts = [...prev.parts];
      nextParts.splice(curPartIdx + 1, 0, newPart);

      return { ...prev, pages: updatedPages, parts: nextParts };
    });
    onToast(`Schnitt nach Seite ${pageIdx0 + 1} aktualisiert.`);
  };

  const handleRotatePage = (pageIdx0: number) => {
    onUpdateTab((prev) => ({
      ...prev,
      pages: prev.pages.map((p, idx) =>
        idx === pageIdx0 ? { ...p, rotation: (p.rotation + 90) % 360 } : p
      ),
    }));
  };

  const handleRemovePage = (pageIdx0: number) => {
    if (tab.pages.length <= 1) {
      onToast('Die letzte verbleibende Seite kann nicht entfernt werden.');
      return;
    }
    onUpdateTab((prev) => {
      const remaining = prev.pages.filter((_, idx) => idx !== pageIdx0);
      const usedPartIds = new Set(remaining.map((p) => p.partId));
      return {
        ...prev,
        pages: remaining,
        parts: prev.parts.filter((part) => usedPartIds.has(part.id)),
        activePageIndex: Math.min(prev.activePageIndex, remaining.length - 1),
      };
    });
    onToast(`Seite ${pageIdx0 + 1} abgereiht.`);
  };

  const handleRemovePart = (partId: string) => {
    const remainingPages = tab.pages.filter((p) => p.partId !== partId);
    if (remainingPages.length === 0) {
      onToast('Mindestens ein Part muss im Dokument verbleiben.');
      return;
    }
    onUpdateTab((prev) => ({
      ...prev,
      pages: prev.pages.filter((p) => p.partId !== partId),
      parts: prev.parts.filter((p) => p.id !== partId),
      activePageIndex: 0,
    }));
    onToast('Part aus der Ansicht abgereiht.');
  };

  const handleAppendPdf = async () => {
    const filesToAdd: { name: string; data: Uint8Array }[] = [];
    if (isElectron()) {
      const paths = await window.electronAPI.openFiles('pdf');
      for (const filePath of paths) {
        const f = await window.electronAPI.readBinary(filePath);
        filesToAdd.push({ name: f.name, data: f.data });
      }
    } else {
      const picked = await pickLocalFilesWeb('.pdf');
      for (const f of picked) {
        filesToAdd.push({ name: f.name, data: f.data });
      }
    }
    if (!filesToAdd.length) return;

    for (const file of filesToAdd) {
      const count = await loadPdfPageCount(file.data);
      const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newPartId = `part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const partName = file.name.replace(/\.pdf$/i, '');

      onUpdateTab((prev) => {
        const newPart: PdfPart = {
          id: newPartId,
          name: partName,
          color: PART_COLORS[prev.parts.length % PART_COLORS.length],
        };
        const appendedPages: VirtualPage[] = Array.from({ length: count }, (_, i) => ({
          id: `${sourceId}_p${i}`,
          sourceId,
          sourcePageIndex: i,
          rotation: 0,
          partId: newPartId,
        }));
        return {
          ...prev,
          sources: [...prev.sources, { id: sourceId, name: file.name, bytes: file.data }],
          parts: [...prev.parts, newPart],
          pages: [...prev.pages, ...appendedPages],
        };
      });
      onToast(`„${file.name}“ (${count} Seiten) angereiht.`);
    }
  };

  const handleSaveSinglePart = async (part: PdfPart) => {
    const partPages = tab.pages.filter((p) => p.partId === part.id);
    if (!partPages.length) return;
    const bytes = await buildPdfFromPages(tab.sources, partPages, highlights, formValues, signatures);
    if (!isElectron()) {
      saveBytesBrowserFallback(`${part.name}.pdf`, bytes, 'application/pdf');
      onToast(`Part „${part.name}.pdf“ gespeichert.`);
      return;
    }
    const res = await window.electronAPI.saveBinary({
      defaultPath: `${part.name}.pdf`,
      filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
      data: bytes,
    });
    if (!res.canceled && res.filePath) {
      onUpdateTab((prev) => ({
        ...prev,
        parts: prev.parts.map((p) =>
          p.id === part.id ? { ...p, savedPath: res.filePath } : p
        ),
      }));
      onToast(`Part „${part.name}“ gespeichert (bleibt weiter geöffnet).`);
    }
  };

  const handleSaveAllParts = async () => {
    const payload: { fileName: string; data: Uint8Array }[] = [];
    for (const part of tab.parts) {
      const partPages = tab.pages.filter((p) => p.partId === part.id);
      if (!partPages.length) continue;
      const bytes = await buildPdfFromPages(tab.sources, partPages, highlights, formValues, signatures);
      payload.push({ fileName: `${part.name}.pdf`, data: bytes });
    }
    if (!payload.length) return;
    if (!isElectron()) {
      payload.forEach((p) => saveBytesBrowserFallback(p.fileName, p.data, 'application/pdf'));
      onToast(`${payload.length} PDF-Parts gespeichert.`);
      return;
    }
    const res = await window.electronAPI.savePartsBatch(payload);
    if (!res.canceled) {
      onToast(`${res.savedPaths.length} PDF-Parts erfolgreich im Ordner gespeichert.`);
    }
  };

  const handleSaveCombinedPdf = async () => {
    const bytes = await buildPdfFromPages(tab.sources, tab.pages, highlights, formValues, signatures);
    const baseName = tab.title.replace(/\.pdf$/i, '');
    if (!isElectron()) {
      saveBytesBrowserFallback(`${baseName}_bearbeitet.pdf`, bytes, 'application/pdf');
      onToast('PDF gespeichert.');
      return;
    }
    const res = await window.electronAPI.saveBinary({
      defaultPath: `${baseName}_bearbeitet.pdf`,
      filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
      data: bytes,
    });
    if (!res.canceled) {
      onToast('Gesamte PDF gespeichert.');
    }
  };

  const handleUploadCombinedToPc = async () => {
    const bytes = await buildPdfFromPages(tab.sources, tab.pages, highlights, formValues, signatures);
    const baseName = tab.title.replace(/\.pdf$/i, '');
    const res = await uploadToPc(`${baseName}_handy.pdf`, bytes);
    if (res.ok) {
      onToast(`Auf PC gespeichert: ${res.savedName}`);
    } else {
      onToast(res.error ?? 'Upload fehlgeschlagen.');
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setSearchMatches([]);
      return;
    }
    const matches: number[] = [];
    for (let i = 0; i < tab.pages.length; i++) {
      const vp = tab.pages[i];
      const src = tab.sources.find((s) => s.id === vp.sourceId);
      if (!src) continue;
      const doc = await getPdfJsDoc(src);
      const page = await doc.getPage(vp.sourcePageIndex + 1);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .toLowerCase();
      if (text.includes(q)) {
        matches.push(i);
      }
    }
    setSearchMatches(matches);
    setSearchIdx(0);
    if (matches.length > 0) {
      goToPage(matches[0]);
      onToast(`${matches.length} Treffer gefunden.`);
    } else {
      onToast('Keine Treffer im Dokument.');
    }
  };

  const handleSendCurrentPageToStudio = async () => {
    if (!activePage || !activeSource) return;
    const dataUrl = await extractPdfPageAsDataUrl(
      activeSource,
      activePage.sourcePageIndex,
      2.0,
      activePage.rotation
    );
    onSendImageToStudio(
      `${tab.title.replace(/\.pdf$/i, '')}_Seite_${tab.activePageIndex + 1}.png`,
      dataUrl
    );
  };

  const renderPageShell = (vp: VirtualPage, idx: number, isActiveHighlight: boolean) => {
    const src = tab.sources.find((s) => s.id === vp.sourceId);
    if (!src) return null;
    const pageHighlights = highlights.filter((h) => h.pageId === vp.id);
    const pageSignatures = signatures.filter((s) => s.pageId === vp.id);

    const isSelected = selectedPageIds.has(vp.id);
    return (
      <div
        key={vp.id}
        ref={(el) => {
          if (el) pageRefs.current.set(idx, el);
          else pageRefs.current.delete(idx);
        }}
        className="pdf-page-shell"
        onClick={(e) => {
          if (pendingSignature) {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = (e.clientX - rect.left) / rect.width;
            const clickY = (e.clientY - rect.top) / rect.height;
            const sigData = pendingSignature;
            setPendingSignature(null);
            const img = new Image();
            img.onload = () => {
              const aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
              const wNorm = 0.22;
              const hNorm = wNorm * aspect * (rect.width / Math.max(1, rect.height));
              const placement: PdfSignaturePlacement = {
                id: `sigp_${Date.now()}`,
                pageId: vp.id,
                dataUrl: sigData,
                xNorm: Math.min(1 - wNorm, Math.max(0, clickX - wNorm / 2)),
                yNorm: Math.min(1 - hNorm, Math.max(0, clickY - hNorm / 2)),
                wNorm,
                hNorm,
              };
              onUpdateTab((prev) => ({
                ...prev,
                signatures: [...(prev.signatures ?? []), placement],
              }));
              onToast('Unterschrift platziert! Ziehen zum Verschieben, Ecke ziehen zum Skalieren.');
            };
            img.src = sigData;
            return;
          }
          if (selectMode) {
            toggleSelectPage(vp.id);
          } else if (!highlightMode && idx !== tab.activePageIndex) {
            onUpdateTab((prev) => ({ ...prev, activePageIndex: idx }));
          }
        }}
        style={{
          outline: isSelected
            ? '3px solid #10b981'
            : isActiveHighlight
              ? '2px solid var(--accent)'
              : 'none',
          cursor: pendingSignature || highlightMode || selectMode ? 'crosshair' : 'auto',
        }}
        onMouseDown={(e) => {
          if (!highlightMode) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const xNorm = (e.clientX - rect.left) / rect.width;
          const yNorm = (e.clientY - rect.top) / rect.height;
          setDraftHighlight({ pageId: vp.id, x1: xNorm, y1: yNorm, x2: xNorm, y2: yNorm });
        }}
        onMouseMove={(e) => {
          if (!highlightMode || !draftHighlight || draftHighlight.pageId !== vp.id) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const xNorm = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          const yNorm = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
          setDraftHighlight((prev) => (prev ? { ...prev, x2: xNorm, y2: yNorm } : null));
        }}
        onMouseUp={() => {
          if (!highlightMode || !draftHighlight || draftHighlight.pageId !== vp.id) return;
          const xNorm = Math.min(draftHighlight.x1, draftHighlight.x2);
          const yNorm = Math.min(draftHighlight.y1, draftHighlight.y2);
          const wNorm = Math.abs(draftHighlight.x2 - draftHighlight.x1);
          const hNorm = Math.abs(draftHighlight.y2 - draftHighlight.y1);
          setDraftHighlight(null);
          if (wNorm > 0.01 && hNorm > 0.005) {
            const hl: PdfHighlight = {
              id: `hl_${Date.now()}`,
              pageId: vp.id,
              xNorm,
              yNorm,
              wNorm,
              hNorm,
              color: highlightColor,
            };
            onUpdateTab((prev) => ({
              ...prev,
              highlights: [...(prev.highlights ?? []), hl],
            }));
          }
        }}
      >
        <PageCanvas
          source={src}
          pageIndex0={vp.sourcePageIndex}
          scale={zoom}
          extraRotation={vp.rotation}
          enableTextLayer={!highlightMode}
        />

        {/* Existing Highlights */}
        {pageHighlights.map((hl) => (
          <div
            key={hl.id}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onUpdateTab((prev) => ({
                ...prev,
                highlights: (prev.highlights ?? []).filter((item) => item.id !== hl.id),
              }));
            }}
            title="Doppelklick zum Entfernen"
            style={{
              position: 'absolute',
              left: `${hl.xNorm * 100}%`,
              top: `${hl.yNorm * 100}%`,
              width: `${hl.wNorm * 100}%`,
              height: `${hl.hNorm * 100}%`,
              background: hl.color,
              opacity: 0.35,
              pointerEvents: highlightMode ? 'none' : 'auto',
              cursor: 'pointer',
            }}
          />
        ))}

        {/* Existing Signatures */}
        {pageSignatures.map((sig) => (
          <div
            key={sig.id}
            style={{
              position: 'absolute',
              left: `${sig.xNorm * 100}%`,
              top: `${sig.yNorm * 100}%`,
              width: `${sig.wNorm * 100}%`,
              height: `${sig.hNorm * 100}%`,
              border: '1px dashed rgba(59, 130, 246, 0.7)',
              cursor: 'move',
              touchAction: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.stopPropagation();
              const shell = e.currentTarget.parentElement;
              if (!shell) return;
              const r = shell.getBoundingClientRect();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragSigState({
                id: sig.id,
                mode: 'move',
                startX: e.clientX,
                startY: e.clientY,
                origX: sig.xNorm,
                origY: sig.yNorm,
                origW: sig.wNorm,
                origH: sig.hNorm,
                shellW: r.width,
                shellH: r.height,
              });
            }}
            onPointerMove={(e) => {
              if (!dragSigState || dragSigState.id !== sig.id) return;
              const dx = (e.clientX - dragSigState.startX) / dragSigState.shellW;
              const dy = (e.clientY - dragSigState.startY) / dragSigState.shellH;
              onUpdateTab((prev) => ({
                ...prev,
                signatures: (prev.signatures ?? []).map((item) => {
                  if (item.id !== sig.id) return item;
                  if (dragSigState.mode === 'move') {
                    return {
                      ...item,
                      xNorm: Math.min(1 - item.wNorm, Math.max(0, dragSigState.origX + dx)),
                      yNorm: Math.min(1 - item.hNorm, Math.max(0, dragSigState.origY + dy)),
                    };
                  }
                  const nextW = Math.max(0.05, Math.min(1 - item.xNorm, dragSigState.origW + dx));
                  const ratio = dragSigState.origH / Math.max(0.001, dragSigState.origW);
                  return {
                    ...item,
                    wNorm: nextW,
                    hNorm: Math.min(1 - item.yNorm, nextW * ratio),
                  };
                }),
              }));
            }}
            onPointerUp={() => setDragSigState(null)}
          >
            <img
              src={sig.dataUrl}
              alt="Unterschrift"
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
            />
            <button
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onUpdateTab((prev) => ({
                  ...prev,
                  signatures: (prev.signatures ?? []).filter((s) => s.id !== sig.id),
                }));
              }}
              title="Unterschrift entfernen"
              style={{
                position: 'absolute',
                top: -10,
                right: -10,
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: 'none',
                background: '#ef4444',
                color: '#fff',
                fontSize: 12,
                lineHeight: '22px',
                textAlign: 'center',
                padding: 0,
                cursor: 'pointer',
                zIndex: 5,
              }}
            >
              ✕
            </button>
            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                const shell = e.currentTarget.parentElement?.parentElement;
                if (!shell) return;
                const r = shell.getBoundingClientRect();
                e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
                setDragSigState({
                  id: sig.id,
                  mode: 'resize',
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: sig.xNorm,
                  origY: sig.yNorm,
                  origW: sig.wNorm,
                  origH: sig.hNorm,
                  shellW: r.width,
                  shellH: r.height,
                });
              }}
              title="Größe ändern"
              style={{
                position: 'absolute',
                right: -5,
                bottom: -5,
                width: 12,
                height: 12,
                background: '#3b82f6',
                borderRadius: 2,
                cursor: 'nwse-resize',
              }}
            />
          </div>
        ))}

        {/* Draft Highlight */}
        {draftHighlight && draftHighlight.pageId === vp.id && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(draftHighlight.x1, draftHighlight.x2) * 100}%`,
              top: `${Math.min(draftHighlight.y1, draftHighlight.y2) * 100}%`,
              width: `${Math.abs(draftHighlight.x2 - draftHighlight.x1) * 100}%`,
              height: `${Math.abs(draftHighlight.y2 - draftHighlight.y1) * 100}%`,
              background: highlightColor,
              opacity: 0.4,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    );
  };

  const renderOutlineItems = (entries: OutlineEntry[], depth = 0) =>
    entries.map((entry, i) => (
      <div key={`${depth}_${i}`}>
        <div
          className="thumb-card"
          style={{
            padding: '6px 8px',
            marginLeft: depth * 12,
            marginBottom: 4,
            fontSize: 12,
          }}
          onClick={() => {
            if (entry.pageIndex0 !== null) goToPage(entry.pageIndex0);
          }}
        >
          <span>{entry.title}</span>
          {entry.pageIndex0 !== null && (
            <span style={{ float: 'right', color: 'var(--text-muted)' }}>
              S. {entry.pageIndex0 + 1}
            </span>
          )}
        </div>
        {entry.children.length > 0 && renderOutlineItems(entry.children, depth + 1)}
      </div>
    ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Top Toolbar */}
      <div className="toolbar">
        <div className="toolbar-group">
          <button
            className={`btn ${showSidebar ? 'active' : ''}`}
            onClick={() => setShowSidebar((s) => !s)}
            title="Seitenleiste ein-/ausblenden"
          >
            Seiten
          </button>
          <button
            className="btn"
            onClick={() => goToPage(tab.activePageIndex - 1)}
            disabled={tab.activePageIndex <= 0}
            title="Vorherige Seite"
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 12.5, padding: '0 4px' }}>
            Seite{' '}
            <input
              className="input-compact"
              style={{ width: 48, textAlign: 'center' }}
              type="number"
              min={1}
              max={tab.pages.length}
              value={tab.activePageIndex + 1}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) goToPage(v - 1);
              }}
            />{' '}
            / {tab.pages.length}
          </span>
          <button
            className="btn"
            onClick={() => goToPage(tab.activePageIndex + 1)}
            disabled={tab.activePageIndex >= tab.pages.length - 1}
            title="Nächste Seite"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="toolbar-group">
          <button
            className="btn"
            onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}
            title="Verkleinern"
          >
            <ZoomOut size={16} />
          </button>
          <span style={{ fontSize: 12.5, minWidth: 46, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="btn"
            onClick={() => setZoom((z) => Math.min(3.5, +(z + 0.15).toFixed(2)))}
            title="Vergrößern"
          >
            <ZoomIn size={16} />
          </button>
          <button className="btn" onClick={() => setZoom(1.0)} title="100% Originalgröße">
            <Maximize2 size={14} /> 100%
          </button>
          <button
            className={`btn ${viewMode === 'scroll' ? 'active' : ''}`}
            onClick={() => setViewMode((m) => (m === 'single' ? 'scroll' : 'single'))}
            title="Einzelseite / Scroll-Ansicht umschalten"
          >
            <Columns size={15} /> {viewMode === 'scroll' ? 'Scroll' : 'Einzeln'}
          </button>
        </div>

        <div className="toolbar-group">
          <button
            className={`btn ${highlightMode ? 'active' : ''}`}
            onClick={() => {
              setHighlightMode((m) => !m);
              if (!highlightMode) {
                onToast('Textmarker aktiv: Auf der PDF-Seite ziehen (Doppelklick löscht Markierung).');
              }
            }}
            title="Textmarker direkt auf der PDF-Seite (Doppelklick zum Entfernen)"
          >
            <Highlighter size={15} /> Textmarker
          </button>
          {highlightMode && (
            <select
              className="input-compact"
              value={highlightColor}
              onChange={(e) => setHighlightColor(e.target.value)}
            >
              <option value="#fde047">Gelb</option>
              <option value="#4ade80">Grün</option>
              <option value="#f472b6">Pink</option>
              <option value="#38bdf8">Blau</option>
            </select>
          )}
          <button
            className="btn"
            onClick={() => handleRotatePage(tab.activePageIndex)}
            title="Aktuelle Seite um 90° drehen"
          >
            <RotateCw size={15} /> Drehen
          </button>
          <button
            className={`btn ${pendingSignature ? 'btn-primary' : ''}`}
            onClick={() => {
              if (pendingSignature) {
                setPendingSignature(null);
              } else {
                savedScrollTopRef.current = viewportRef.current?.scrollTop ?? null;
                setShowSignatureModal(true);
              }
            }}
            title="Unterschrift zeichnen oder PNG/JPG (ohne Papierhintergrund) auf PDF setzen"
          >
            <PenTool size={15} /> {pendingSignature ? 'Klick auf Seite...' : 'Unterschrift'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handleSplitAfterPage(tab.activePageIndex)}
            disabled={tab.activePageIndex >= tab.pages.length - 1}
            title="Dokument genau nach dieser Seite in Parts trennen (oder Schnitt wieder aufheben)"
          >
            <Scissors size={15} /> Nach S. {tab.activePageIndex + 1} trennen
          </button>
          <button
            className="btn"
            onClick={handleAppendPdf}
            title="Weitere PDF hinten anreihen"
          >
            <FilePlus2 size={15} /> PDF anreihen
          </button>
          <button
            className={`btn ${selectMode ? 'active' : ''}`}
            onClick={() => {
              setSelectMode((m) => !m);
              if (selectMode) setSelectedPageIds(new Set());
            }}
            title="Mehrere Seiten frei auswählen und als eigene PDF speichern"
          >
            Auswahl{selectedPageIds.size > 0 ? ` (${selectedPageIds.size})` : ''}
          </button>
          {selectMode && selectedPageIds.size > 0 && (
            <button
              className="btn btn-success"
              onClick={handleSaveSelectedPages}
              title="Ausgewählte Seiten als separate PDF speichern"
            >
              <Save size={14} /> Auswahl speichern
            </button>
          )}
        </div>

        <div className="toolbar-group">
          <button
            className="btn btn-success"
            onClick={handleSendCurrentPageToStudio}
            title="Aktuelle Seite als Bild ins KI-Markierungsstudio übernehmen"
          >
            <Sparkles size={15} /> Für KI markieren
          </button>
        </div>

        <div className="toolbar-group">
          <input
            className="input-compact"
            style={{ width: 140 }}
            placeholder="Text suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
          />
          <button className="btn" onClick={handleSearch} title="Suchen">
            <Search size={15} />
          </button>
          {searchMatches.length > 0 && (
            <button
              className="btn"
              onClick={() => {
                const next = (searchIdx + 1) % searchMatches.length;
                setSearchIdx(next);
                goToPage(searchMatches[next]);
              }}
            >
              {searchIdx + 1}/{searchMatches.length}
            </button>
          )}
        </div>

        <div className="toolbar-group">
          <button
            className="btn"
            onClick={handleSaveCombinedPdf}
            title="Ohne Trennung als eine Gesamt-PDF speichern (Original bleibt erhalten)"
          >
            <Save size={15} /> Ohne Trennung speichern
          </button>
          {!isElectron() && (
            <button
              className="btn btn-success"
              onClick={handleUploadCombinedToPc}
              title="PDF direkt auf deinen gekoppelten PC speichern"
            >
              Auf PC speichern
            </button>
          )}
          {isElectron() && (
            <button
              className="btn"
              onClick={() => window.electronAPI.printWindow()}
              title="Drucken"
            >
              <Printer size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Main Split Body */}
      <div className="workspace-body">
        {/* Left Sidebar */}
        {showSidebar && (
        <aside className="sidebar" style={{ width: sidebarTab === 'form' ? 290 : 248 }}>
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${sidebarTab === 'pages' ? 'active' : ''}`}
              onClick={() => setSidebarTab('pages')}
            >
              Seiten
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'parts' ? 'active' : ''}`}
              onClick={() => setSidebarTab('parts')}
            >
              Parts
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'outline' ? 'active' : ''}`}
              onClick={() => setSidebarTab('outline')}
            >
              Inhalt
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'form' ? 'active' : ''}`}
              onClick={() => setSidebarTab('form')}
            >
              Formular{formFields.length > 0 ? ` (${formFields.length})` : ''}
            </button>
          </div>

          {sidebarTab === 'pages' && (
            <div className="thumbnail-list">
              {tab.pages.map((vp, idx) => {
                const src = tab.sources.find((s) => s.id === vp.sourceId);
                if (!src) return null;
                const part = partMap.get(vp.partId);
                const nextVp = tab.pages[idx + 1];
                const isSplitHere = nextVp && nextVp.partId !== vp.partId;

                return (
                  <React.Fragment key={vp.id}>
                    <div
                      className={`thumb-card ${idx === tab.activePageIndex ? 'active' : ''}`}
                      onClick={() => goToPage(idx)}
                    >
                      <div
                        className="thumb-part-strip"
                        style={{ background: part?.color ?? '#3b82f6' }}
                      />
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          borderRadius: 4,
                          background: '#fff',
                        }}
                      >
                        <PageCanvas
                          source={src}
                          pageIndex0={vp.sourcePageIndex}
                          scale={0.26}
                          extraRotation={vp.rotation}
                        />
                      </div>
                      <div className="thumb-actions">
                        <span>
                          S. {idx + 1} ·{' '}
                          <strong style={{ color: part?.color }}>{part?.name.slice(0, 12)}</strong>
                        </span>
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            className="btn"
                            style={{ padding: '2px 4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRotatePage(idx);
                            }}
                            title="Seite drehen"
                          >
                            <RotateCw size={12} />
                          </button>
                          <button
                            className="btn btn-danger-ghost"
                            style={{ padding: '2px 4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemovePage(idx);
                            }}
                            title="Seite abreihen"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {idx < tab.pages.length - 1 && (
                      <div
                        className="split-divider"
                        onClick={() => handleSplitAfterPage(idx)}
                        title={
                          isSplitHere
                            ? 'Schnittmarke hier entfernen'
                            : `Nach Seite ${idx + 1} trennen`
                        }
                      >
                        <div className="split-divider-line" />
                        <Scissors size={11} />
                        <span>{isSplitHere ? 'Getrennt' : 'Trennen'}</span>
                        <div className="split-divider-line" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {sidebarTab === 'parts' && (
            <div className="thumbnail-list">
              {tab.parts.map((part, pIdx) => {
                const indices = tab.pages
                  .map((p, i) => (p.partId === part.id ? i : -1))
                  .filter((i) => i >= 0);
                if (indices.length === 0) return null;
                const firstPage = indices[0] + 1;
                const lastPage = indices[indices.length - 1] + 1;

                return (
                  <div
                    key={part.id}
                    className="thumb-card"
                    style={{ borderLeft: `4px solid ${part.color}` }}
                    onClick={() => goToPage(indices[0])}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      {pIdx + 1}. {part.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Seiten {firstPage} bis {lastPage} ({indices.length} Seiten)
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 8px', fontSize: 11.5 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveSinglePart(part);
                        }}
                      >
                        <Save size={12} /> Speichern
                      </button>
                      {tab.parts.length > 1 && (
                        <button
                          className="btn btn-danger-ghost"
                          style={{ padding: '4px 8px', fontSize: 11.5 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemovePart(part.id);
                          }}
                        >
                          <Trash2 size={12} /> Abreihen
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {sidebarTab === 'outline' && (
            <div className="thumbnail-list">
              {outline.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: 8 }}>
                  Dieses Dokument enthält kein Inhaltsverzeichnis / keine Lesezeichen.
                </div>
              ) : (
                renderOutlineItems(outline)
              )}
            </div>
          )}

          {sidebarTab === 'form' && (
            <div className="thumbnail-list">
              {formFields.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: 8 }}>
                  Keine ausfüllbaren Formularfelder (AcroForm) in diesem Dokument gefunden.
                </div>
              ) : (
                <>
                  <button
                    className="btn btn-success"
                    style={{ marginBottom: 8 }}
                    onClick={async () => {
                      const summary = formFields
                        .map((f) => `${f.name}: ${String(formValues[f.name] ?? f.value)}`)
                        .join('\n');
                      await window.electronAPI.writeClipboardText(summary);
                      onToast('Alle Formularfelder in Zwischenablage kopiert.');
                    }}
                  >
                    <ClipboardCopy size={14} /> Alle Felder auslesen & kopieren
                  </button>
                  {formFields.map((field) => {
                    const curVal = formValues[field.name] ?? field.value;
                    return (
                      <div
                        key={field.name}
                        className="thumb-card"
                        style={{ cursor: 'default', display: 'flex', flexDirection: 'column', gap: 4 }}
                      >
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                          {field.name}
                        </label>
                        {field.kind === 'checkbox' ? (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                            <input
                              type="checkbox"
                              checked={Boolean(curVal)}
                              onChange={(e) =>
                                onUpdateTab((prev) => ({
                                  ...prev,
                                  formValues: { ...(prev.formValues ?? {}), [field.name]: e.target.checked },
                                }))
                              }
                            />
                            Aktiviert
                          </label>
                        ) : field.kind === 'dropdown' || field.kind === 'radio' ? (
                          <select
                            className="input-compact"
                            value={String(curVal)}
                            onChange={(e) =>
                              onUpdateTab((prev) => ({
                                ...prev,
                                formValues: { ...(prev.formValues ?? {}), [field.name]: e.target.value },
                              }))
                            }
                          >
                            <option value="">(Auswählen)</option>
                            {(field.options ?? []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input-compact"
                            type="text"
                            value={String(curVal)}
                            onChange={(e) =>
                              onUpdateTab((prev) => ({
                                ...prev,
                                formValues: { ...(prev.formValues ?? {}), [field.name]: e.target.value },
                              }))
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </aside>
        )}

        {/* Main Viewport */}
        <main className="main-viewport" ref={viewportRef} onScroll={handleViewportScroll}>
          {viewMode === 'single' && activePage && renderPageShell(activePage, tab.activePageIndex, false)}

          {viewMode === 'scroll' &&
            tab.pages.map((vp, idx) => renderPageShell(vp, idx, idx === tab.activePageIndex))}
        </main>
      </div>

      {/* Interactive Bottom Parts Bar */}
      <div className="parts-bar">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
          Parts & Export:
        </span>
        {tab.parts.map((part) => {
          const indices = tab.pages
            .map((p, i) => (p.partId === part.id ? i : -1))
            .filter((i) => i >= 0);
          if (indices.length === 0) return null;
          const isActive = activePage?.partId === part.id;

          return (
            <div
              key={part.id}
              className={`part-chip ${isActive ? 'active' : ''}`}
              onClick={() => goToPage(indices[0])}
              title="Anklicken zum Springen, Doppelklick zum Umbenennen"
            >
              <span className="part-dot" style={{ background: part.color }} />
              {editingPartId === part.id ? (
                <input
                  className="input-compact"
                  style={{ width: 130, padding: '2px 6px' }}
                  autoFocus
                  value={editingPartName}
                  onChange={(e) => setEditingPartName(e.target.value)}
                  onBlur={() => {
                    if (editingPartName.trim()) {
                      onUpdateTab((prev) => ({
                        ...prev,
                        parts: prev.parts.map((p) =>
                          p.id === part.id ? { ...p, name: editingPartName.trim() } : p
                        ),
                      }));
                    }
                    setEditingPartId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingPartId(part.id);
                    setEditingPartName(part.name);
                  }}
                >
                  <strong>{part.name}</strong> (S. {indices[0] + 1}–
                  {indices[indices.length - 1] + 1})
                </span>
              )}
              <button
                className="btn btn-primary"
                style={{ padding: '2px 7px', fontSize: 11.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveSinglePart(part);
                }}
                title="Diesen Part als eigene PDF speichern"
              >
                <Save size={12} /> Speichern
              </button>
              {tab.parts.length > 1 && (
                <button
                  className="btn btn-danger-ghost"
                  style={{ padding: '2px 5px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePart(part.id);
                  }}
                  title="Part abreihen"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn" onClick={handleAppendPdf}>
            <FilePlus2 size={14} /> Anreihen
          </button>
          {tab.parts.length > 1 && (
            <button className="btn btn-success" onClick={handleSaveAllParts}>
              <FolderOutput size={14} /> Alle {tab.parts.length} Parts speichern
            </button>
          )}
        </div>
      </div>

      {showSignatureModal && (
        <SignatureModal
          onClose={() => {
            setShowSignatureModal(false);
            const restoreY = savedScrollTopRef.current;
            if (restoreY !== null) {
              requestAnimationFrame(() => {
                if (viewportRef.current) viewportRef.current.scrollTop = restoreY;
              });
            }
          }}
          onSelectForPlacement={(dataUrl) => {
            setShowSignatureModal(false);
            setPendingSignature(dataUrl);
            const restoreY = savedScrollTopRef.current;
            if (restoreY !== null) {
              requestAnimationFrame(() => {
                if (viewportRef.current) viewportRef.current.scrollTop = restoreY;
              });
            }
            onToast('Klicke jetzt auf die gewünschte Stelle auf der PDF-Seite.');
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
};
