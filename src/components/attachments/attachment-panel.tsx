"use client";

import { useState, useCallback } from "react";
import {
  LucidePaperclip,
  LucideUpload,
  LucideTrash2,
  LucideFile,
  LucideImage,
  LucideFileText,
  LucideX,
  LucideLoader2,
} from "lucide-react";

export type AttachmentParentType = "transaction" | "debtPayment" | "savingTx" | "remittance";

export type AttachmentRecord = {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  createdAt: string;
};

interface AttachmentPanelProps {
  parentType: AttachmentParentType;
  parentId: string;
  initialAttachments?: AttachmentRecord[];
  disabled?: boolean;
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <LucideImage className="h-4 w-4 text-sky-400" />;
  if (mimeType === "application/pdf") return <LucideFileText className="h-4 w-4 text-red-400" />;
  return <LucideFile className="h-4 w-4 text-slate-400" />;
}

export function AttachmentPanel({
  parentType,
  parentId,
  initialAttachments = [],
  disabled = false,
}: AttachmentPanelProps) {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);

      if (!ALLOWED_TYPES.includes(file.type)) {
        setError("Only JPEG, PNG, WebP, and PDF files are allowed.");
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError("File exceeds 5 MB limit.");
        return;
      }

      if (attachments.length >= 5) {
        setError("Maximum 5 attachments per record.");
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("parentType", parentType);
      form.append("parentId", parentId);

      setUploading(true);
      try {
        const res = await fetch("/api/attachments/upload", {
          method: "POST",
          body: form,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Upload failed");
        }

        const newAttachment: AttachmentRecord = await res.json();
        setAttachments((prev) => [...prev, newAttachment]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [attachments.length, parentId, parentType]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(uploadFile);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError("Failed to delete attachment.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
        <LucidePaperclip className="h-4 w-4 text-slate-400" />
        Attachments
        <span className="ml-auto text-xs text-slate-500">
          {attachments.length}/5 · Max 5 MB each
        </span>
      </div>

      {/* Existing Attachments */}
      {attachments.length > 0 && (
        <ul className="mb-3 space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-3 rounded-lg border border-slate-700/40 bg-slate-800 px-3 py-2"
            >
              <FileIcon mimeType={att.mimeType} />
              <a
                href={`/api/attachments/${att.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1"
              >
                <p className="truncate text-sm text-slate-200 hover:text-emerald-400 transition-colors">
                  {att.originalName}
                </p>
                <p className="text-xs text-slate-500">{formatBytes(att.fileSize)}</p>
              </a>
              {!disabled && (
                <button
                  onClick={() => handleDelete(att.id)}
                  disabled={deletingId === att.id}
                  className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                  title="Delete attachment"
                >
                  {deletingId === att.id ? (
                    <LucideLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LucideTrash2 className="h-4 w-4" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Drop zone / Upload button */}
      {!disabled && attachments.length < 5 && (
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-5 transition-colors ${
            isDragging
              ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
              : "border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {uploading ? (
            <LucideLoader2 className="h-5 w-5 animate-spin text-emerald-400" />
          ) : (
            <LucideUpload className="h-5 w-5" />
          )}
          <span className="text-xs">
            {uploading ? "Uploading…" : "Drop files or click to upload"}
          </span>
          <span className="text-xs text-slate-600">JPEG · PNG · WebP · PDF</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            className="sr-only"
            onChange={handleFileInput}
            disabled={uploading || disabled}
          />
        </label>
      )}

      {/* Error */}
      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <LucideX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
          <button
            className="ml-auto text-red-500 hover:text-red-300"
            onClick={() => setError(null)}
          >
            <LucideX className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
