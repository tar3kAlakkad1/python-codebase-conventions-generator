import type { KnowledgeGraph } from "@/lib/types";

export async function analyzeGraphWithLLM(_graph: KnowledgeGraph): Promise<{ conventions: unknown[] }> {
  return { conventions: [] };
}

export default analyzeGraphWithLLM;

