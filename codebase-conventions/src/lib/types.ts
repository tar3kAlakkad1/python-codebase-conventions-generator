export interface CodeNode {
  id: string;
  label: string;
  type: string;
  filePath?: string;
  line?: number;
  column?: number;
  metadata?: Record<string, unknown>;
}

export interface CodeEdge {
  id: string;
  source: string; // CodeNode.id
  target: string; // CodeNode.id
  relation: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

export interface UploadedFile {
  name: string;
  content: string;
  path?: string;
}

export interface ParseOptions {
  dialect?: "python";
  includeDocstrings?: boolean;
  includeComments?: boolean;
}

export type { CodeNode as TCodeNode, CodeEdge as TCodeEdge };

