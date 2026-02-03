import { useEffect, useMemo, useState } from "react";
import { PDFDocument, degrees, rgb } from "pdf-lib";
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

type Tool = "merge" | "img2pdf";

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
  return tool === "merge" ? "var(--accent-merge)" : "var(--accent-img)";
}

function toolLabel(tool: Tool) {
  return tool === "merge" ? "Merge PDFs" : "Images → PDF";
}

function toolSubtitle(tool: Tool) {
  if (tool === "merge") {
    return "Drop PDFs, reorder, merge, download. Runs locally in your browser.";
  }
  return "Drop JPG/PNG images, reorder, convert to a single PDF. Runs locally in your browser.";
}

function hashToTool(hash: string): Tool {
  const h = hash.replace("#", "").trim();
  if (h === "img" || h === "img2pdf" || h === "images") return "img2pdf";
  return "merge";
}

function toolToHash(tool: Tool) {
  return tool === "merge" ? "merge" : "img2pdf";
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
  const [tool, setTool] = useState<Tool>(() => hashToTool(window.location.hash));

  const [pdfItems, setPdfItems] = useState<PdfItem[]>([]);
  const [imgItems, setImgItems] = useState<ImgItem[]>([]);

  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [imgSettings, setImgSettings] = useState<ImgSettings>({
    pageSize: "letter",
    fit: "contain",
    orientation: "auto",
    margin: 24,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  useEffect(() => {
    const onHash = () => setTool(hashToTool(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const next = `#${toolToHash(tool)}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, [tool]);

  const activeCount = tool === "merge" ? pdfItems.length : imgItems.length;
  const activeBytes = useMemo(() => {
    const list = tool === "merge" ? pdfItems : imgItems;
    return list.reduce((sum, it) => sum + it.file.size, 0);
  }, [tool, pdfItems, imgItems]);

  const activeMb = useMemo(() => bytesToMb(activeBytes), [activeBytes]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

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
    setPdfItems((prev) => prev.filter((x) => x.id !== id));
  }

  function removeImg(id: string) {
    setImgItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((x) => x.id !== id);
    });
  }

  function clearActive() {
    setError(null);
    if (tool === "merge") {
      setPdfItems([]);
      return;
    }
    setImgItems((prev) => {
      prev.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
  }

  function addFiles(fileList: FileList | null) {
    setError(null);
    if (!fileList || fileList.length === 0) return;

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

      const outBytes = await mergedPdf.save();
      downloadBytes(outBytes, `merged_${ymd()}.pdf`, "application/pdf");
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
      downloadBytes(outBytes, `images_${ymd()}.pdf`, "application/pdf");
    } catch (err: any) {
      setError(err?.message ?? "Convert failed.");
    } finally {
      setIsWorking(false);
    }
  }

  const listItems = tool === "merge" ? pdfItems : imgItems;
  const dndIds = listItems.map((x) => x.id);

  return (
    <div className="wrap">
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
                    {tool === "merge" ? "Add PDFs" : "Add Images"}
                    <input
                      type="file"
                      multiple
                      accept={
                        tool === "merge"
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
                    ) : (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={imagesToPdf}
                        disabled={isWorking || imgItems.length < 1}
                        title={imgItems.length < 1 ? "Add at least one image" : "Convert and download"}
                      >
                        {isWorking ? "Converting..." : "Convert + Download"}
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

              {tool === "img2pdf" && (
                <div className="settings">
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
                          orientation: e.target.value as ImgSettings["orientation"],
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
            </div>

            <div className="panel">
              {activeCount === 0 ? (
                <div className="empty">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {toolLabel(tool)}
                  </div>
                  <div>
                    Add files to see the reorder list. Nothing gets uploaded.
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

                      {tool === "merge"
                        ? pdfItems.map((it, idx) => {
                            const pages =
                              it.pages === null ? "n/a" : String(it.pages);
                            const info = `${pages} page(s) • ${bytesToMb(
                              it.file.size
                            )} MB`;
                            return (
                              <SortableRow
                                key={it.id}
                                id={it.id}
                                title={`${idx + 1}. ${it.file.name}`}
                                subtitle={"PDF"}
                                info={info}
                                actions={
                                  <button
                                    type="button"
                                    className="miniBtn"
                                    onClick={() => removePdf(it.id)}
                                    disabled={isWorking}
                                  >
                                    Remove
                                  </button>
                                }
                              />
                            );
                          })
                        : imgItems.map((it, idx) => {
                            const dim =
                              it.width && it.height
                                ? `${it.width}×${it.height}`
                                : "n/a";
                            const rot = it.rotation ? ` • ${it.rotation}°` : "";
                            const info = `${dim}${rot} • ${bytesToMb(
                              it.file.size
                            )} MB`;
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
    </div>
  );
}
