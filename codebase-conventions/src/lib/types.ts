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

// Parsed Python structures (regex-first MVP)

export interface ParsedCall {
  name: string; // e.g., "func", "obj.method"
  line: number; // 1-based
  column?: number;
  qualified?: string; // same as name for now; reserved for future resolution
}

export interface ParsedFunction {
  name: string;
  parameters: string[]; // raw parameter tokens
  returnHint?: string;
  isAsync: boolean;
  isPrivate: boolean; // leading underscore
  decorators: string[]; // e.g., ["@staticmethod", "@decorator(arg)"]
  lineStart: number; // definition line (1-based)
  lineEnd: number; // best-effort
  docstring?: string;
  codeExcerpt?: string;
  calls: ParsedCall[]; // intra-function call sites
}

export interface ParsedClass {
  name: string;
  baseClasses: string[]; // raw base names
  decorators: string[];
  docstring?: string;
  lineStart: number;
  lineEnd: number;
  codeExcerpt?: string;
  methods: ParsedFunction[]; // methods discovered within the class
}

export interface ParsedImport {
  importType: "import" | "from";
  module: string; // for "from ... import ..." this is the from-module; for "import ..." this is the first module token
  names: { name: string; alias?: string }[]; // for import x as y, or from m import a as b
  line: number;
  code: string;
}

export interface ParsedVariable {
  name: string;
  valueSnippet?: string; // right-hand side truncated
  line: number;
}

export interface ParsedModule {
  filePath: string; // absolute or relative path
  moduleName: string; // derived from filename
  classes: ParsedClass[];
  functions: ParsedFunction[]; // top-level functions only
  imports: ParsedImport[];
  variables: ParsedVariable[]; // top-level assignments only
}

export type ParseResult = ParsedModule[];

