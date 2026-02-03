import { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Toast from "./components/Toast";
import { useLocalStorageState } from "./hooks/useLocalStorageState";

type Tool = "merge" | "img2pdf" | "extract";

type PdfItem = {
  id: string;
  file: File;
  pages: number | null;
};

type ImgItem = {
  id: string;
  file: File;
  url: string;
  width: number | null;
  height: number | null;
  rotation: 0 | 90 | 180 | 270;
};

type ImgSettings = {
  pageSize: "letter" | "a4";
  fit: "contain" | "cover";
  orientation: "auto" | "portrait" | "landscape";
  margin: number;
};

type UndoState = {
  tool: Tool;
  item: PdfItem | ImgItem;
  index: number;
};

const PAGE_SIZES = {
  letter: { w: 612, h: 792 },
  a4: { w: 595.28, h: 841.89 },
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function bytesToMb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function ymd() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeFilename(input: string, fallback: string) {
  const cleaned = input.replace(/[\\/:*?"<>|]/g, "").trim();
  const base = cleaned.length ? cleaned : fallback;
  const withExt = base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  return withExt;
}

async function getPdfPageCount(file: File): Promise<number | null> {
  try {
    const bytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
  } catch {
    return null;
  }
}

async function getImageSize(url: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to read image."));
  });
  return { w: img.naturalWidth, h: img.naturalHeight };
}

function fitRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
  mode: "contain" | "cover"
) {
  const sx = boxW / srcW;
  const sy = boxH / srcH;
  const s = mode === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  return { w: srcW * s, h: srcH * s, s };
}

function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function accentFor(tool: Tool) {
  if (tool === "merge") return "var(--accent-merge)";
  if (tool === "img2pdf") return "var(--accent-img)";
  return "var(--accent-extract)";
}

function toolLabel(tool: Tool) {
  if (tool === "merge") return "Merge PDFs";
  if (tool === "img2pdf") return "Images → PDF";
  return "Extract Pages";
}

function toolSubtitle(tool: Tool) {
  if (tool === "merge") {
    return "Drop PDFs, reorder, merge, download. Runs locally in your browser.";
  }
  if (tool === "img2pdf") {
    return "Drop JPG/PNG images, reorder, convert to a single PDF. Runs locally in your browser.";
  }
  return "Select pages from a PDF and download a new file. Runs locally in your browser.";
}

function hashToTool(hash: string): Tool {
  const h = hash.replace("#", "").trim();
  if (h === "img" || h === "img2pdf" || h === "images") return "img2pdf";
  if (h === "extract" || h === "pages") return "extract";
  return "merge";
}

function toolToHash(tool: Tool) {
  if (tool === "merge") return "merge";
  if (tool === "img2pdf") return "img2pdf";
  return "extract";
}

function parsePageRange(range: string, totalPages: number) {
  const cleaned = range.replace(/\s+/g, "");
  if (!cleaned) return null;
  const tokens = cleaned.split(",");
  const pages: number[] = [];
  const seen = new Set<number>();

  for (const token of tokens) {
    if (!token) return null;
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n < 1 || n > totalPages) return null;
      if (!seen.has(n)) {
        pages.push(n - 1);
        seen.add(n);
      }
      continue;
    }
    if (/^\d+-\d+$/.test(token)) {
      const [start, end] = token.split("-").map(Number);
      if (start < 1 || end < 1 || start > end || end > totalPages) return null;
      for (let i = start; i <= end; i += 1) {
        if (!seen.has(i)) {
          pages.push(i - 1);
          seen.add(i);
        }
      }
      continue;
    }
    return null;
  }

  return pages.length ? pages : null;
}

function SortableRow(props: {
  id: string;
  title: string;
  subtitle: string;
  info: string;
  actions: React.ReactNode;
}) {
  const { id, title, subtitle, info, actions } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };

  return (
    <div ref={setNodeRef} className="row" style={style}>
      <button
        type="button"
        className="handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⇅
      </button>

      <div style={{ minWidth: 0 }}>
        <div className="fileName">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>

      <div className="sub" style={{ textAlign: "right" }}>
        {info}
      </div>

      <div className="actions">{actions}</div>
    </div>
  );
}

export default function App() {
  const [tool, setTool] = useLocalStorageState<Tool>("pdfkit_tool", "merge");

  const [pdfItems, setPdfItems] = useState<PdfItem[]>([]);
  const [imgItems, setImgItems] = useState<ImgItem[]>([]);
  const [extractItem, setExtractItem] = useState<PdfItem | null>(null);
  const [extractRange, setExtractRange] = useState("");

  const [mergeFilename, setMergeFilename] = useLocalStorageState(
    "pdfkit_merge_filename",
    `merged_${ymd()}.pdf`
  );
  const [imgFilename, setImgFilename] = useLocalStorageState(
    "pdfkit_img_filename",
    `images_${ymd()}.pdf`
  );
  const [extractFilename, setExtractFilename] = useLocalStorageState(
    "pdfkit_extract_filename",
    `extracted_${ymd()}.pdf`
  );

  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addPageNumbers, setAddPageNumbers] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState("");

  const [imgSettings, setImgSettings] = useLocalStorageState<ImgSettings>(
    "pdfkit_img_settings",
    {
      pageSize: "letter",
      fit: "contain",
      orientation: "auto",
      margin: 24,
    }
  );

  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoRef = useRef<UndoState | null>(null);
  const undoTimeout = useRef<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function finalizeUndo(state: UndoState | null) {
    if (!state) return;
    if (state.tool === "img2pdf") {
      const img = state.item as ImgItem;
      URL.revokeObjectURL(img.url);
    }
  }

  function clearUndo(finalize: boolean) {
    if (undoTimeout.current) {
      window.clearTimeout(undoTimeout.current);
      undoTimeout.current = null;
    }
    if (finalize) finalizeUndo(undoRef.current);
    undoRef.current = null;
    setUndo(null);
  }

  function pushUndo(next: UndoState) {
    clearUndo(true);
    undoRef.current = next;
    setUndo(next);
    undoTimeout.current = window.setTimeout(() => {
      finalizeUndo(undoRef.current);
      undoRef.current = null;
      setUndo(null);
      undoTimeout.current = null;
    }, 5000);
  }

  function handleUndo() {
    const state = undoRef.current;
    if (!state) return;

    if (state.tool === "merge") {
      setPdfItems((prev) => {
        const copy = [...prev];
        copy.splice(state.index, 0, state.item as PdfItem);
        return copy;
      });
    } else if (state.tool === "img2pdf") {
      setImgItems((prev) => {
        const copy = [...prev];
        copy.splice(state.index, 0, state.item as ImgItem);
        return copy;
      });
    } else {
      setExtractItem(state.item as PdfItem);
    }

    clearUndo(false);
  }

  useEffect(() => {
    if (window.location.hash) {
      setTool(hashToTool(window.location.hash));
    }
  }, [setTool]);

  useEffect(() => {
    const onHash = () => setTool(hashToTool(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const next = `#${toolToHash(tool)}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, [tool]);

  useEffect(() => {
    setError(null);
    clearUndo(true);
  }, [tool]);

  const activeCount =
    tool === "merge"
      ? pdfItems.length
      : tool === "img2pdf"
      ? imgItems.length
      : extractItem
      ? 1
      : 0;
  const activeBytes = useMemo(() => {
    const list =
      tool === "merge"
        ? pdfItems
        : tool === "img2pdf"
        ? imgItems
        : extractItem
        ? [extractItem]
        : [];
    return list.reduce((sum, it) => sum + it.file.size, 0);
  }, [tool, pdfItems, imgItems, extractItem]);

  const activeMb = useMemo(() => bytesToMb(activeBytes), [activeBytes]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

    if (tool === "extract") return;

    if (tool === "merge") {
      setPdfItems((prev) => {
        const oldIndex = prev.findIndex((x) => x.id === active.id);
        const newIndex = prev.findIndex((x) => x.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
      return;
    }

    setImgItems((prev) => {
      const oldIndex = prev.findIndex((x) => x.id === active.id);
      const newIndex = prev.findIndex((x) => x.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function removePdf(id: string) {
    setPdfItems((prev) => {
      const index = prev.findIndex((x) => x.id === id);
      if (index === -1) return prev;
      const item = prev[index];
      pushUndo({ tool: "merge", item, index });
      return prev.filter((x) => x.id !== id);
    });
  }

  function removeImg(id: string) {
    setImgItems((prev) => {
      const index = prev.findIndex((x) => x.id === id);
      if (index === -1) return prev;
      const item = prev[index];
      pushUndo({ tool: "img2pdf", item, index });
      return prev.filter((x) => x.id !== id);
    });
  }

  function removeExtract() {
    if (!extractItem) return;
    pushUndo({ tool: "extract", item: extractItem, index: 0 });
    setExtractItem(null);
  }

  function movePdf(index: number, dir: -1 | 1) {
    setPdfItems((prev) => arrayMove(prev, index, index + dir));
  }

  function moveImg(index: number, dir: -1 | 1) {
    setImgItems((prev) => arrayMove(prev, index, index + dir));
  }

  function clearActive() {
    setError(null);
    clearUndo(true);
    if (tool === "merge") {
      setPdfItems([]);
      return;
    }
    if (tool === "img2pdf") {
      setImgItems((prev) => {
        prev.forEach((x) => URL.revokeObjectURL(x.url));
        return [];
      });
      return;
    }
    setExtractItem(null);
  }

  function addFiles(fileList: FileList | null) {
    setError(null);
    if (!fileList || fileList.length === 0) return;

    if (tool === "extract") {
      const pdfs = Array.from(fileList).filter(
        (f) =>
          f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfs.length === 0) {
        setError("No PDFs detected. Please add a PDF file.");
        return;
      }
      if (pdfs.length > 1) {
        setError("Please add only one PDF for extraction.");
        return;
      }
      const file = pdfs[0];
      const next: PdfItem = { id: crypto.randomUUID(), file, pages: null };
      setExtractItem(next);
      getPdfPageCount(file).then((pages) => {
        setExtractItem((prev) =>
          prev ? { ...prev, pages } : prev
        );
      });
      return;
    }

    if (tool === "merge") {
      const pdfs = Array.from(fileList).filter(
        (f) =>
          f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfs.length === 0) {
        setError("No PDFs detected. Please add PDF files.");
        return;
      }

      const next: PdfItem[] = pdfs.map((file) => ({
        id: crypto.randomUUID(),
        file,
        pages: null,
      }));

      setPdfItems((prev) => [...prev, ...next]);

      // page counts (best effort)
      next.forEach(async (it) => {
        const pages = await getPdfPageCount(it.file);
        setPdfItems((prev) =>
          prev.map((p) => (p.id === it.id ? { ...p, pages } : p))
        );
      });
      return;
    }

    const imgs = Array.from(fileList).filter((f) => {
      const t = f.type;
      const n = f.name.toLowerCase();
      return (
        t === "image/jpeg" ||
        t === "image/png" ||
        n.endsWith(".jpg") ||
        n.endsWith(".jpeg") ||
        n.endsWith(".png")
      );
    });

    if (imgs.length === 0) {
      setError("No JPG/PNG images detected. Please add image files.");
      return;
    }

    const next: ImgItem[] = imgs.map((file) => {
      const url = URL.createObjectURL(file);
      return {
        id: crypto.randomUUID(),
        file,
        url,
        width: null,
        height: null,
        rotation: 0,
      };
    });

    setImgItems((prev) => [...prev, ...next]);

    next.forEach(async (it) => {
      try {
        const { w, h } = await getImageSize(it.url);
        setImgItems((prev) =>
          prev.map((p) => (p.id === it.id ? { ...p, width: w, height: h } : p))
        );
      } catch {
        // keep nulls
      }
    });
  }

  async function mergeAndDownload() {
    setError(null);
    if (pdfItems.length < 2) {
      setError("Add at least two PDFs to merge.");
      return;
    }

    setIsWorking(true);
    try {
      const mergedPdf = await PDFDocument.create();
      for (const it of pdfItems) {
        const bytes = await it.file.arrayBuffer();
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(src, src.getPageIndices());
        copiedPages.forEach((p) => mergedPdf.addPage(p));
      }

      if (addPageNumbers || (watermarkEnabled && watermarkText.trim())) {
        const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
        const pages = mergedPdf.getPages();
        const totalPages = pages.length;
        const markText = watermarkText.trim();

        pages.forEach((page, idx) => {
          const { width, height } = page.getSize();

          if (addPageNumbers) {
            const text = `${idx + 1} / ${totalPages}`;
            const size = 10;
            const textWidth = font.widthOfTextAtSize(text, size);
            page.drawText(text, {
              x: width - textWidth - 10,
              y: 10,
              size,
              font,
              color: rgb(0, 0, 0),
              opacity: 0.45,
            });
          }

          if (watermarkEnabled && markText) {
            const size = Math.min(48, Math.max(24, width / 10));
            const textWidth = font.widthOfTextAtSize(markText, size);
            page.drawText(markText, {
              x: (width - textWidth) / 2,
              y: height / 2,
              size,
              font,
              color: rgb(0, 0, 0),
              opacity: 0.12,
              rotate: degrees(-35),
            });
          }
        });
      }

      const outBytes = await mergedPdf.save();
      const name = sanitizeFilename(mergeFilename, `merged_${ymd()}.pdf`);
      downloadBytes(outBytes, name, "application/pdf");
    } catch (err: any) {
      setError(err?.message ?? "Merge failed.");
    } finally {
      setIsWorking(false);
    }
  }

  function rotateImg(id: string) {
    setImgItems((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              rotation: ((x.rotation + 90) % 360) as 0 | 90 | 180 | 270,
            }
          : x
      )
    );
  }

  async function imagesToPdf() {
    setError(null);
    if (imgItems.length < 1) {
      setError("Add at least one image.");
      return;
    }

    const margin = clamp(Number(imgSettings.margin) || 0, 0, 128);
    setIsWorking(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const base = PAGE_SIZES[imgSettings.pageSize];

      for (const it of imgItems) {
        const bytes = new Uint8Array(await it.file.arrayBuffer());
        const name = it.file.name.toLowerCase();
        const isJpg =
          it.file.type === "image/jpeg" ||
          name.endsWith(".jpg") ||
          name.endsWith(".jpeg");

        const img = isJpg
          ? await pdfDoc.embedJpg(bytes)
          : await pdfDoc.embedPng(bytes);

        const imgW = img.width;
        const imgH = img.height;
        const rot = it.rotation;

        const rotW = rot === 90 || rot === 270 ? imgH : imgW;
        const rotH = rot === 90 || rot === 270 ? imgW : imgH;

        let pageW: number = base.w;
        let pageH: number = base.h;

        const wantLandscape =
          imgSettings.orientation === "landscape" ||
          (imgSettings.orientation === "auto" && rotW > rotH);

        const wantPortrait = imgSettings.orientation === "portrait";

        if (wantLandscape && !wantPortrait) {
          const temp = pageW;
          pageW = pageH;
          pageH = temp;
        }

        const page = pdfDoc.addPage([pageW, pageH]);
        page.drawRectangle({
          x: 0,
          y: 0,
          width: pageW,
          height: pageH,
          color: rgb(1, 1, 1),
        });

        const boxW = pageW - margin * 2;
        const boxH = pageH - margin * 2;

        const fitted = fitRect(rotW, rotH, boxW, boxH, imgSettings.fit);
        const bboxW = fitted.w;
        const bboxH = fitted.h;

        const bx = (pageW - bboxW) / 2;
        const by = (pageH - bboxH) / 2;

        // width/height passed to drawImage are unrotated sizes.
        // scale based on original dimensions.
        const scale = rot === 90 || rot === 270 ? bboxW / imgH : bboxW / imgW;
        const drawW = imgW * scale;
        const drawH = imgH * scale;

        let x = bx;
        let y = by;

        if (rot === 90) {
          x = bx + drawH;
          y = by;
        } else if (rot === 180) {
          x = bx + drawW;
          y = by + drawH;
        } else if (rot === 270) {
          x = bx;
          y = by + drawW;
        }

        page.drawImage(img, {
          x,
          y,
          width: drawW,
          height: drawH,
          rotate: degrees(rot),
        });
      }

      const outBytes = await pdfDoc.save();
      const name = sanitizeFilename(imgFilename, `images_${ymd()}.pdf`);
      downloadBytes(outBytes, name, "application/pdf");
    } catch (err: any) {
      setError(err?.message ?? "Convert failed.");
    } finally {
      setIsWorking(false);
    }
  }

  async function extractAndDownload() {
    setError(null);
    if (!extractItem) {
      setError("Add a PDF to extract from.");
      return;
    }
    if (!extractRange.trim()) {
      setError("Enter a page range like 1-3,6,9-12.");
      return;
    }

    setIsWorking(true);
    try {
      const bytes = await extractItem.file.arrayBuffer();
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const totalPages = src.getPageCount();
      const indices = parsePageRange(extractRange, totalPages);

      if (!indices) {
        setError(`Invalid range. Use values between 1 and ${totalPages}.`);
        return;
      }

      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));

      const outBytes = await out.save();
      const name = sanitizeFilename(extractFilename, `extracted_${ymd()}.pdf`);
      downloadBytes(outBytes, name, "application/pdf");
    } catch (err: any) {
      setError(err?.message ?? "Extraction failed.");
    } finally {
      setIsWorking(false);
    }
  }

  const listItems =
    tool === "merge"
      ? pdfItems
      : tool === "img2pdf"
      ? imgItems
      : extractItem
      ? [extractItem]
      : [];
  const dndIds = listItems.map((x) => x.id);

  return (
    <div
      className="wrap"
      style={{ "--accent": accentFor(tool) } as React.CSSProperties}
    >
      <div className="shell">
        <div className="shellHeader">
          <div className="topRow">
            <div>
              <div className="brand">
                <span
                  className="brandDot"
                  style={{ background: accentFor(tool) }}
                />
                <h1 className="title">PDF Kit</h1>
                <span className="chip">Local-only</span>
              </div>
              <p className="subtitle">{toolSubtitle(tool)}</p>
            </div>

            <div className="meta">
              <div>{activeCount} file(s)</div>
              <div>{activeMb} MB total</div>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Tools">
            <button
              type="button"
              className="tabBtn"
              aria-selected={tool === "merge"}
              onClick={() => setTool("merge")}
            >
              <span
                className="brandDot"
                style={{ background: "var(--accent-merge)" }}
              />
              Merge PDFs
            </button>
            <button
              type="button"
              className="tabBtn"
              aria-selected={tool === "img2pdf"}
              onClick={() => setTool("img2pdf")}
            >
              <span
                className="brandDot"
                style={{ background: "var(--accent-img)" }}
              />
              Images → PDF
            </button>
            <button
              type="button"
              className="tabBtn"
              aria-selected={tool === "extract"}
              onClick={() => setTool("extract")}
            >
              <span
                className="brandDot"
                style={{ background: "var(--accent-extract)" }}
              />
              Extract Pages
            </button>
          </div>
        </div>

        <div className="shellBody">
          <div className="toolGrid">
            <div className="panel panelPad">
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(e.dataTransfer.files);
                }}
              >
                <div className="dzRow">
                  <label className="btn" style={{ fontWeight: 700 }}>
                    {tool === "merge"
                      ? "Add PDFs"
                      : tool === "img2pdf"
                      ? "Add Images"
                      : "Add PDF"}
                    <input
                      type="file"
                      multiple={tool !== "extract"}
                      accept={
                        tool === "merge" || tool === "extract"
                          ? "application/pdf,.pdf"
                          : "image/png,image/jpeg,.png,.jpg,.jpeg"
                      }
                      onChange={(e) => addFiles(e.target.files)}
                      style={{ display: "none" }}
                      disabled={isWorking}
                    />
                  </label>

                  <div className="dzHint">or drag and drop here</div>

                  <div className="btnRow">
                    <button
                      type="button"
                      className="btn"
                      onClick={clearActive}
                      disabled={activeCount === 0 || isWorking}
                    >
                      Clear
                    </button>

                    {tool === "merge" ? (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={mergeAndDownload}
                        disabled={isWorking || pdfItems.length < 2}
                        title={
                          pdfItems.length < 2
                            ? "Add at least two PDFs"
                            : "Merge and download"
                        }
                      >
                        {isWorking ? "Merging..." : "Merge + Download"}
                      </button>
                    ) : tool === "img2pdf" ? (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={imagesToPdf}
                        disabled={isWorking || imgItems.length < 1}
                        title={
                          imgItems.length < 1
                            ? "Add at least one image"
                            : "Convert and download"
                        }
                      >
                        {isWorking ? "Converting..." : "Convert + Download"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={extractAndDownload}
                        disabled={isWorking || !extractItem}
                        title={!extractItem ? "Add a PDF to extract" : "Extract and download"}
                      >
                        {isWorking ? "Extracting..." : "Extract + Download"}
                      </button>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="error">
                    <div className="errorTitle">Error</div>
                    <div style={{ color: "var(--muted)" }}>{error}</div>
                  </div>
                )}
              </div>

              {tool === "merge" && (
                <div className="settings">
                  <div className="field">
                    <div className="label">Output filename</div>
                    <input
                      type="text"
                      value={mergeFilename}
                      onChange={(e) => setMergeFilename(e.target.value)}
                      placeholder={`merged_${ymd()}.pdf`}
                      disabled={isWorking}
                    />
                  </div>

                  <div className="field toggleRow">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={addPageNumbers}
                        onChange={(e) => setAddPageNumbers(e.target.checked)}
                        disabled={isWorking}
                      />
                      Add page numbers
                    </label>
                    <span className="hint">Bottom-right, subtle.</span>
                  </div>

                  <div className="field toggleRow">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={watermarkEnabled}
                        onChange={(e) => setWatermarkEnabled(e.target.checked)}
                        disabled={isWorking}
                      />
                      Watermark text
                    </label>
                  </div>

                  {watermarkEnabled && (
                    <div className="field">
                      <div className="label">Watermark</div>
                      <input
                        type="text"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        placeholder="Confidential"
                        disabled={isWorking}
                      />
                    </div>
                  )}
                </div>
              )}

              {tool === "img2pdf" && (
                <div className="settings">
                  <div className="field">
                    <div className="label">Output filename</div>
                    <input
                      type="text"
                      value={imgFilename}
                      onChange={(e) => setImgFilename(e.target.value)}
                      placeholder={`images_${ymd()}.pdf`}
                      disabled={isWorking}
                    />
                  </div>

                  <div className="field">
                    <div className="label">Page size</div>
                    <select
                      value={imgSettings.pageSize}
                      onChange={(e) =>
                        setImgSettings((s) => ({
                          ...s,
                          pageSize: e.target.value as ImgSettings["pageSize"],
                        }))
                      }
                      disabled={isWorking}
                    >
                      <option value="letter">Letter</option>
                      <option value="a4">A4</option>
                    </select>
                  </div>

                  <div className="field">
                    <div className="label">Fit</div>
                    <select
                      value={imgSettings.fit}
                      onChange={(e) =>
                        setImgSettings((s) => ({
                          ...s,
                          fit: e.target.value as ImgSettings["fit"],
                        }))
                      }
                      disabled={isWorking}
                    >
                      <option value="contain">Fit (contain)</option>
                      <option value="cover">Fill (cover)</option>
                    </select>
                  </div>

                  <div className="field">
                    <div className="label">Orientation</div>
                    <select
                      value={imgSettings.orientation}
                      onChange={(e) =>
                        setImgSettings((s) => ({
                          ...s,
                          orientation:
                            e.target.value as ImgSettings["orientation"],
                        }))
                      }
                      disabled={isWorking}
                    >
                      <option value="auto">Auto per image</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>

                  <div className="field">
                    <div className="label">Margin (pt)</div>
                    <input
                      type="number"
                      value={imgSettings.margin}
                      onChange={(e) =>
                        setImgSettings((s) => ({
                          ...s,
                          margin: clamp(Number(e.target.value) || 0, 0, 128),
                        }))
                      }
                      min={0}
                      max={128}
                      step={4}
                      disabled={isWorking}
                    />
                  </div>
                </div>
              )}

              {tool === "extract" && (
                <div className="settings">
                  <div className="field">
                    <div className="label">Output filename</div>
                    <input
                      type="text"
                      value={extractFilename}
                      onChange={(e) => setExtractFilename(e.target.value)}
                      placeholder={`extracted_${ymd()}.pdf`}
                      disabled={isWorking}
                    />
                  </div>

                  <div className="field">
                    <div className="label">Page range</div>
                    <input
                      type="text"
                      value={extractRange}
                      onChange={(e) => setExtractRange(e.target.value)}
                      placeholder="1-3,6,9-12"
                      disabled={isWorking}
                    />
                    <div className="hint">
                      Use commas and hyphens. Example: 1-3,6,9-12
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="panel">
              {activeCount === 0 ? (
                <div className="empty">
                  <div className="emptyTitle">{toolLabel(tool)}</div>
                  <div className="emptyNote">
                    Add files to see the list. Nothing gets uploaded.
                  </div>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={dndIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="list">
                      <div className="listHeader">
                        <div>Order</div>
                        <div>File</div>
                        <div style={{ textAlign: "right" }}>Info</div>
                        <div style={{ textAlign: "right" }}>Actions</div>
                      </div>

                      {tool === "merge" &&
                        pdfItems.map((it, idx) => {
                          const pages =
                            it.pages === null ? "n/a" : String(it.pages);
                          const info = `${pages} page(s) • ${bytesToMb(
                            it.file.size
                          )} MB`;
                          const isTop = idx === 0;
                          const isBottom = idx === pdfItems.length - 1;
                          return (
                            <SortableRow
                              key={it.id}
                              id={it.id}
                              title={`${idx + 1}. ${it.file.name}`}
                              subtitle={"PDF"}
                              info={info}
                              actions={
                                <>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => movePdf(idx, -1)}
                                    disabled={isWorking || isTop}
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => movePdf(idx, 1)}
                                    disabled={isWorking || isBottom}
                                  >
                                    Down
                                  </button>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => removePdf(it.id)}
                                    disabled={isWorking}
                                  >
                                    Remove
                                  </button>
                                </>
                              }
                            />
                          );
                        })}

                      {tool === "img2pdf" &&
                        imgItems.map((it, idx) => {
                          const dim =
                            it.width && it.height
                              ? `${it.width}×${it.height}`
                              : "n/a";
                          const rot = it.rotation ? ` • ${it.rotation}°` : "";
                          const info = `${dim}${rot} • ${bytesToMb(
                            it.file.size
                          )} MB`;
                          const isTop = idx === 0;
                          const isBottom = idx === imgItems.length - 1;
                          return (
                            <SortableRow
                              key={it.id}
                              id={it.id}
                              title={`${idx + 1}. ${it.file.name}`}
                              subtitle={"Image"}
                              info={info}
                              actions={
                                <>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => moveImg(idx, -1)}
                                    disabled={isWorking || isTop}
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => moveImg(idx, 1)}
                                    disabled={isWorking || isBottom}
                                  >
                                    Down
                                  </button>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => rotateImg(it.id)}
                                    disabled={isWorking}
                                    title="Rotate 90°"
                                  >
                                    Rotate
                                  </button>
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => removeImg(it.id)}
                                    disabled={isWorking}
                                  >
                                    Remove
                                  </button>
                                </>
                              }
                            />
                          );
                        })}

                      {tool === "extract" &&
                        extractItem && (
                          <SortableRow
                            key={extractItem.id}
                            id={extractItem.id}
                            title={`${extractItem.file.name}`}
                            subtitle={"PDF"}
                            info={`${extractItem.pages ?? "n/a"} page(s) • ${bytesToMb(
                              extractItem.file.size
                            )} MB`}
                            actions={
                              <button
                                type="button"
                                className="miniBtn"
                                onClick={removeExtract}
                                disabled={isWorking}
                              >
                                Remove
                              </button>
                            }
                          />
                        )}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>

        <div className="shellFooter">
          Notes: Very large batches can hit browser memory limits. This tool runs
          fully in your browser.
        </div>
      </div>

      <Toast
        open={!!undo}
        message={
          undo
            ? `${undo.tool === "img2pdf" ? "Image" : "File"} removed.`
            : ""
        }
        actionLabel="Undo"
        onAction={handleUndo}
        onClose={() => clearUndo(true)}
      />
    </div>
  );
}
