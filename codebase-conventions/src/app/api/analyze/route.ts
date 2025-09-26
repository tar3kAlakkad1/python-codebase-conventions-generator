import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { UploadedFile, KnowledgeGraph } from "@/lib/types";
import parsePythonFiles from "@/lib/python-parser";
import buildKnowledgeGraphFromParsedModules from "@/lib/graph-builder";

// Edge runtime for fast cold starts
export const runtime = "edge";

const MAX_FILES = 200;
const MAX_TOTAL_CHARS = 2_000_000; // ~2MB total payload guardrail
const DEFAULT_TIMEOUT_MS = 15_000;

// Accept either { name, content } or { filename, content }
const fileSchemaPrimary = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  path: z.string().optional(),
});

const fileSchemaAlt = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
  path: z.string().optional(),
});

const unionFileSchema = z.union([fileSchemaPrimary, fileSchemaAlt]).transform((f) => {
  if ("name" in f) return f as { name: string; content: string; path?: string };
  const g = f as { filename: string; content: string; path?: string };
  return { name: g.filename, content: g.content, path: g.path };
});

const bodySchema = z.object({
  files: z.array(unionFileSchema).optional(),
  codeSnippets: z.array(z.string()).optional(),
  options: z
    .object({
      includeDocstrings: z.boolean().optional(),
    })
    .optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
}).refine((b) => (b.files && b.files.length > 0) || (b.codeSnippets && b.codeSnippets.length > 0), {
  message: "Provide either non-empty 'files' or 'codeSnippets'",
  path: ["files"],
});

function enforceLimits(files: UploadedFile[]) {
  if (files.length > MAX_FILES) {
    throw Object.assign(new Error(`Too many files. Max ${MAX_FILES}.`), { status: 413 });
  }
  const totalChars = files.reduce((acc, f) => acc + (f.content?.length ?? 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    throw Object.assign(new Error(`Payload too large. Total characters exceed ${MAX_TOTAL_CHARS}.`), { status: 413 });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(Object.assign(new Error("Request timed out"), { status: 408 })), ms);
    });
    // Race user work against timeout
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { files, codeSnippets, options, timeoutMs } = parsed.data;

    // Normalize inputs to UploadedFile[]
    const normalizedFiles: UploadedFile[] = [];
    if (Array.isArray(files)) {
      for (const f of files) {
        normalizedFiles.push({ name: f.name, content: f.content, path: f.path });
      }
    }
    if (Array.isArray(codeSnippets)) {
      let c = 1;
      for (const s of codeSnippets) {
        const snippet = (s ?? "").trim();
        if (snippet.length === 0) continue;
        normalizedFiles.push({ name: `pasted-snippet-${c++}.py`, content: snippet });
      }
    }

    if (normalizedFiles.length === 0) {
      return NextResponse.json({ error: "No valid files or snippets provided" }, { status: 400 });
    }

    enforceLimits(normalizedFiles);

    const ms = timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const graph: KnowledgeGraph = await withTimeout(
      (async () => {
        const parsedModules = await parsePythonFiles(normalizedFiles, {
          includeDocstrings: options?.includeDocstrings ?? true,
        });
        return buildKnowledgeGraphFromParsedModules(parsedModules);
      })(),
      ms
    );

    return NextResponse.json({ graph }, { status: 200 });
  } catch (err) {
    const e = err as Error & { status?: number };
    const status = e.status ?? 500;
    return NextResponse.json({ error: e.message || "Internal Server Error" }, { status });
  }
}

