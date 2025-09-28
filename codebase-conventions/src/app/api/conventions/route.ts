import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { KnowledgeGraph } from "@/lib/types";
import analyzeGraphWithLLM from "@/lib/llm-analyzer";

export async function GET() {
  return NextResponse.json({ ok: true, conventions: [] });
}

export const runtime = "edge";


const nodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.string().min(1),
  filePath: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  metadata: z.record(z.any()).optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

const graphSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

const bodySchema = z.object({
  graph: graphSchema,
  codeSnippets: z.array(z.string()).optional(),
});

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

    const { graph, codeSnippets } = parsed.data;

    const result = await analyzeGraphWithLLM(graph as KnowledgeGraph, {
      codeSnippets,
    });

    return NextResponse.json({ markdown: result.markdown }, { status: 200 });
  } catch (err) {
    const e = err as Error & { status?: number };
    const status = e.status ?? 500;
    return NextResponse.json({ error: e.message || "Internal Server Error" }, { status });
  }
}

