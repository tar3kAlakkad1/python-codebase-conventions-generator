import type { UploadedFile, ParseOptions, KnowledgeGraph } from "@/lib/types";

export async function parsePythonFiles(_files: UploadedFile[], _options?: ParseOptions): Promise<KnowledgeGraph> {
  return { nodes: [], edges: [] };
}

export default parsePythonFiles;

