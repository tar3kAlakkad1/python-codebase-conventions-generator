"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone, FileRejection } from "react-dropzone";
import { z } from "zod";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Button,
  TextField,
  Snackbar,
  Alert,
  Chip,
  Divider,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { UploadedFile } from "../lib/types";

export interface CodeUploaderProps {
  onChange?: (files: UploadedFile[]) => void;
  onError?: (message: string) => void;
  maxFileSizeBytes?: number; // default 5MB
  acceptExtensions?: string[]; // default [".py"]
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024;
const DEFAULT_EXTS = [".py"];

const fileSchema = (maxSize: number, allowedExts: string[]) =>
  z.object({
    name: z
      .string()
      .refine((n) =>
        allowedExts.some((ext) => n.toLowerCase().endsWith(ext.toLowerCase()))
      , {
        message: `Only ${allowedExts.join(", ")} files are allowed`,
      }),
    size: z
      .number()
      .max(maxSize, { message: `File exceeds ${(maxSize / (1024 * 1024)).toFixed(0)}MB limit` }),
    type: z.string().optional(),
    content: z.string(),
  });

const snippetSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, { message: "Snippet cannot be empty" })
  .refine((s) => !/\u0000/.test(s), { message: "Snippet contains invalid characters" })
  .refine((s) => s.length <= 200_000, { message: "Snippet too large" });

type Snippet = { id: string; content: string };

export function CodeUploader({
  onChange,
  onError,
  maxFileSizeBytes = DEFAULT_MAX_SIZE,
  acceptExtensions = DEFAULT_EXTS,
}: CodeUploaderProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([{ id: "snippet-1", content: "" }]);
  const [items, setItems] = useState<UploadedFile[]>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "info" | "warning" | "error" }>({ open: false, message: "", severity: "error" });

  const accept = useMemo(() => ({
    "text/x-python": acceptExtensions,
    "application/x-python-code": acceptExtensions,
    "text/plain": acceptExtensions,
  }), [acceptExtensions]);

  const notifyError = useCallback((message: string) => {
    setSnackbar({ open: true, message, severity: "error" });
    onError?.(message);
  }, [onError]);

  const notifyInfo = useCallback((message: string) => {
    setSnackbar({ open: true, message, severity: "info" });
  }, []);

  const emitChange = useCallback((next: UploadedFile[]) => {
    setItems(next);
    onChange?.(next);
  }, [onChange]);

  const handleFileRejections = useCallback((rejections: FileRejection[]) => {
    if (!rejections.length) return;
    const msg = rejections
      .map((r) => `${r.file.name}: ${r.errors.map((e) => e.message).join(", ")}`)
      .join("; ");
    notifyError(msg);
  }, [notifyError]);

  const onDrop = useCallback(async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
    if (fileRejections?.length) {
      handleFileRejections(fileRejections);
    }
    if (!acceptedFiles.length) return;

    const parsed: UploadedFile[] = [];
    for (const file of acceptedFiles) {
      try {
        const text = await file.text();
        const result = fileSchema(maxFileSizeBytes, acceptExtensions).safeParse({
          name: file.name,
          size: file.size,
          type: file.type,
          content: text,
        });
        if (!result.success) {
          const message = result.error.issues.map((i) => i.message).join(", ");
          notifyError(`${file.name}: ${message}`);
          continue;
        }
        parsed.push({ name: file.name, content: text });
      } catch (err) {
        notifyError(`${file.name}: Failed to read file`);
      }
    }

    if (parsed.length) {
      // merge with existing items; de-duplicate by name by appending counter
      const existingNames = new Set(items.map((it) => it.name));
      const merged: UploadedFile[] = [...items];
      for (const p of parsed) {
        let base = p.name;
        let candidate = base;
        let counter = 1;
        while (existingNames.has(candidate)) {
          const dot = base.lastIndexOf(".");
          const prefix = dot > 0 ? base.slice(0, dot) : base;
          const ext = dot > 0 ? base.slice(dot) : "";
          candidate = `${prefix} (${counter})${ext}`;
          counter += 1;
        }
        existingNames.add(candidate);
        merged.push({ name: candidate, content: p.content });
      }
      emitChange(merged);
      notifyInfo(`${parsed.length} file(s) added`);
    }
  }, [acceptExtensions, emitChange, handleFileRejections, items, maxFileSizeBytes, notifyError, notifyInfo]);

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    onDrop,
    accept,
    maxSize: maxFileSizeBytes,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  const handleSnippetChange = (id: string, value: string) => {
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, content: value } : s)));
  };

  const addSnippet = () => {
    setSnippets((prev) => [...prev, { id: `snippet-${prev.length + 1}`, content: "" }]);
  };

  const removeSnippet = (id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  };

  // Normalize snippets to UploadedFile list and emit changes combined with files
  useEffect(() => {
    const validated: UploadedFile[] = [];
    for (let i = 0; i < snippets.length; i += 1) {
      const { content } = snippets[i];
      if (!content) continue; // ignore empty snippets silently
      const res = snippetSchema.safeParse(content);
      if (!res.success) {
        // report first error only once per snippet change
        // do not block others
        notifyError(`Snippet ${i + 1}: ${res.error.issues[0]?.message ?? "Invalid snippet"}`);
        continue;
      }
      validated.push({ name: `pasted-snippet-${i + 1}.py`, content: res.data });
    }
    // merge with file items by name, prefer file items; rename conflicts for snippets
    const existingNames = new Set(items.map((it) => it.name));
    const merged: UploadedFile[] = [...items];
    for (const v of validated) {
      let candidate = v.name;
      let c = 1;
      while (existingNames.has(candidate)) {
        candidate = v.name.replace(/\.py$/i, `-${c}.py`);
        c += 1;
      }
      existingNames.add(candidate);
      merged.push({ name: candidate, content: v.content });
    }
    onChange?.(merged);
  }, [snippets, items, notifyError, onChange]);

  const handleRemoveItem = (name: string) => {
    const next = items.filter((it) => it.name !== name);
    emitChange(next);
  };

  const clearAll = () => {
    setSnippets([{ id: "snippet-1", content: "" }]);
    emitChange([]);
  };

  return (
    <Stack spacing={2}>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderStyle: "dashed",
          bgcolor: isDragActive ? "action.hover" : "background.paper",
        }}
      >
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
          <Box {...getRootProps()} sx={{ flex: 1, cursor: "pointer" }}>
            <input {...getInputProps()} />
            <Stack spacing={0.5}>
              <Typography variant="subtitle1">
                {isDragActive ? "Drop .py files here" : "Drag and drop .py files here"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Max size {Math.floor(maxFileSizeBytes / (1024 * 1024))}MB • Accepted: {acceptExtensions.join(", ")}
              </Typography>
            </Stack>
          </Box>
          <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={openFileDialog}>
            Browse files
          </Button>
        </Stack>
      </Paper>

      <Stack spacing={2}>
        {snippets.map((s, idx) => (
          <Stack key={s.id} spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2">Snippet {idx + 1}</Typography>
              {snippets.length > 1 && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => removeSnippet(s.id)}
                >
                  Remove
                </Button>
              )}
            </Stack>
            <TextField
              placeholder="Paste Python code here"
              value={s.content}
              onChange={(e) => handleSnippetChange(s.id, e.target.value)}
              multiline
              minRows={4}
              fullWidth
            />
          </Stack>
        ))}
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={addSnippet}>
            Add snippet
          </Button>
          <Button color="warning" onClick={clearAll}>Clear all</Button>
        </Stack>
      </Stack>

      <Divider />

      {items.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Selected files</Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {items.map((it) => (
              <Chip key={it.name} label={it.name} onDelete={() => handleRemoveItem(it.name)} />
            ))}
          </Stack>
        </Stack>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Stack>
  );
}

export default CodeUploader;

