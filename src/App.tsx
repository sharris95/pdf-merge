import { useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";
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

type PdfItem = {
  id: string;
  file: File;
};

function bytesToMb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function SortableRow(props: {
  item: PdfItem;
  index: number;
  onRemove: (id: string) => void;
}) {
  const { item, index, onRemove } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "white",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        style={{
          cursor: "grab",
          border: "1px solid rgba(0,0,0,0.12)",
          background: "white",
          borderRadius: 8,
          padding: "6px 10px",
          fontFamily: "inherit",
        }}
      >
        ⇅
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {index + 1}. {item.file.name}
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          {bytesToMb(item.file.size)} MB
        </div>
      </div>

      <button
        type="button"
        onClick={() => onRemove(item.id)}
        style={{
          border: "1px solid rgba(0,0,0,0.12)",
          background: "white",
          borderRadius: 8,
          padding: "6px 10px",
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        Remove
      </button>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState<PdfItem[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const totalSizeMb = useMemo(
    () =>
      Math.round(
        (items.reduce((sum, it) => sum + it.file.size, 0) / (1024 * 1024)) * 10
      ) / 10,
    [items]
  );

  function addFiles(fileList: FileList | null) {
    setError(null);
    if (!fileList || fileList.length === 0) return;

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
    }));

    setItems((prev) => [...prev, ...next]);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

    setItems((prev) => {
      const oldIndex = prev.findIndex((x) => x.id === active.id);
      const newIndex = prev.findIndex((x) => x.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  function clearAll() {
    setItems([]);
    setError(null);
  }

  async function mergeAndDownload() {
    setError(null);
    if (items.length < 2) {
      setError("Add at least two PDFs to merge.");
      return;
    }

    setIsMerging(true);
    try {
      const mergedPdf = await PDFDocument.create();

      for (const it of items) {
        const bytes = await it.file.arrayBuffer();
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(
          src,
          src.getPageIndices()
        );
        copiedPages.forEach((p) => mergedPdf.addPage(p));
      }

      const outBytes = await mergedPdf.save();
      const blob = new Blob([outBytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `merged_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? "Merge failed.");
    } finally {
      setIsMerging(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f6f3ed", color: "#141313" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 26 }}>PDF Merge Tool</h1>
            <p style={{ margin: "6px 0 0", opacity: 0.75 }}>
              Drop PDFs, reorder, merge, download. Runs locally in your browser.
            </p>
          </div>
          <div style={{ fontSize: 13, opacity: 0.75, textAlign: "right" }}>
            <div>{items.length} file(s)</div>
            <div>{totalSizeMb} MB total</div>
          </div>
        </header>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          style={{
            marginTop: 16,
            border: "2px dashed rgba(0,0,0,0.2)",
            borderRadius: 14,
            padding: 18,
            background: "rgba(255,255,255,0.6)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
            }}
          >
            <label
              style={{
                display: "inline-block",
                border: "1px solid rgba(0,0,0,0.12)",
                background: "white",
                borderRadius: 10,
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Add PDFs
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(e) => addFiles(e.target.files)}
                style={{ display: "none" }}
              />
            </label>

            <div style={{ opacity: 0.75 }}>or drag and drop here</div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={clearAll}
                disabled={items.length === 0 || isMerging}
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "white",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor:
                    items.length === 0 || isMerging ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                Clear
              </button>

              <button
                type="button"
                onClick={mergeAndDownload}
                disabled={isMerging || items.length < 2}
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#141313",
                  color: "white",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor:
                    isMerging || items.length < 2
                      ? "not-allowed"
                      : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                }}
              >
                {isMerging ? "Merging..." : "Merge + Download"}
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 10,
                background: "rgba(180,87,62,0.12)",
              }}
            >
              <div style={{ fontWeight: 600 }}>Error</div>
              <div style={{ opacity: 0.9 }}>{error}</div>
            </div>
          )}
        </div>

        <main style={{ marginTop: 16 }}>
          {items.length === 0 ? (
            <div style={{ padding: 18, opacity: 0.7 }}>
              Add a few PDFs to see the reorder list.
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={items.map((x) => x.id)}
                strategy={verticalListSortingStrategy}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((it, idx) => (
                    <SortableRow
                      key={it.id}
                      item={it}
                      index={idx}
                      onRemove={removeItem}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </main>

        <footer style={{ marginTop: 18, fontSize: 13, opacity: 0.75 }}>
          Notes: Very large PDFs can hit browser memory limits. If you need huge
          merges, we can add an optional server mode later.
        </footer>
      </div>
    </div>
  );
}
