import type { KnowledgeGraph, CodeNode, CodeEdge } from "@/lib/types";

type LLMAnalyzeOptions = {
  codeSnippets?: string[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  apiKey?: string;
  systemPrompt?: string;
};

type AnalyzeResult = {
  markdown: string;
  model: string;
  usedOffline: boolean;
};

/**
 * Analyze a KnowledgeGraph and optionally code snippets to generate conventions markdown.
 * Attempts to use OpenAI if an API key is available; otherwise falls back to heuristics.
 */
export async function analyzeGraphWithLLM(
  graph: KnowledgeGraph,
  options: LLMAnalyzeOptions = {}
): Promise<AnalyzeResult> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  const model = options.model ?? (process.env.OPENAI_MODEL || "gpt-4o-mini");
  const maxTokens = options.maxTokens ?? 4000;
  const temperature = options.temperature ?? 0.2;
  const timeoutMs = options.timeoutMs ?? 45_000;

  // Collect representative code samples from the graph
  const samples = collectCodeSamples(graph, options.codeSnippets, 12, 24_000);
  const graphPayload = safeStringifyGraph(graph, 200, 400, 100_000);

  if (!apiKey) {
    const markdown = generateHeuristicMarkdown(graph, samples);
    return { markdown, model: "offline-heuristics", usedOffline: true };
  }

  try {
    // Lazy import to remain edge-friendly if unused
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, timeout: timeoutMs });

    const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const user = buildUserPrompt(graphPayload, samples);

    // Prefer chat.completions for broad compatibility
    const resp = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = resp.choices?.[0]?.message?.content?.trim();
    if (content && content.length > 0) {
      return { markdown: content, model, usedOffline: false };
    }

    // Fallback if model returned nothing
    const markdown = generateHeuristicMarkdown(graph, samples);
    return { markdown, model: "offline-heuristics", usedOffline: true };
  } catch (_err) {
    const markdown = generateHeuristicMarkdown(graph, samples);
    return { markdown, model: "offline-heuristics", usedOffline: true };
  }
}

export default analyzeGraphWithLLM;

// ------------------------------
// Prompt construction
// ------------------------------

const DEFAULT_SYSTEM_PROMPT = [
  "You are a senior Python code reviewer.",
  "Given a knowledge graph of a Python codebase and representative code samples, identify coding conventions and produce a conventions.md.",
  "Be specific and cite concrete examples from provided code snippets whenever possible.",
].join(" ");

function buildUserPrompt(graphPayload: string, codeSamples: string[]): string {
  const header = [
    "Analyze the following graph and samples to document conventions:",
    "",
    "GRAPH DATA:",
  ].join("\n");

  const instructions = [
    "",
    "CODE SAMPLES:",
    ...codeSamples.map((s, i) => `--- SAMPLE ${i + 1} ---\n${truncate(s, 2000)}`),
    "",
    "Please analyze and document these categories:",
    "1. Naming Conventions (functions, classes, private methods, constants)",
    "2. Code Structure (modules, classes, inheritance)",
    "3. Common Patterns (decorators, type hints %, async/await, error handling)",
    "4. Import Conventions (organization, absolute vs relative if detectable)",
    "5. Documentation (docstring coverage %, style if inferable)",
    "",
    "Return markdown formatted for a conventions.md with:",
    "- Pattern name",
    "- Description",
    "- Code examples (from provided samples)",
    "- % adoption rate (estimate)",
    "- Recommendations",
  ].join("\n");

  // Keep graph payload at the top to help the model build context
  return `${header}\n${graphPayload}\n${instructions}`;
}

// ------------------------------
// Offline heuristic fallback
// ------------------------------

function generateHeuristicMarkdown(graph: KnowledgeGraph, codeSamples: string[]): string {
  const fnNodes = graph.nodes.filter((n) => n.type === "function");
  const classNodes = graph.nodes.filter((n) => n.type === "class");
  const moduleNodes = graph.nodes.filter((n) => n.type === "module");

  // Naming: snake_case for functions/methods
  let snakeCount = 0;
  let fnTotal = 0;
  let privateMethodCount = 0;

  for (const fn of fnNodes) {
    const baseName = extractFunctionBaseName(fn.label);
    if (baseName) {
      fnTotal++;
      if (/^[a-z_][a-z0-9_]*$/.test(baseName)) snakeCount++;
      if (baseName.startsWith("_")) privateMethodCount++;
    }
  }

  const fnSnakePct = toPct(snakeCount, fnTotal);
  const privatePct = toPct(privateMethodCount, fnTotal);

  // Classes: PascalCase
  let pascalClasses = 0;
  for (const c of classNodes) {
    if (/^[A-Z][A-Za-z0-9]*$/.test(c.label)) pascalClasses++;
  }
  const classPascalPct = toPct(pascalClasses, classNodes.length);

  // Type hints and async, decorators, docstrings
  let functionsWithAnyTypeHint = 0;
  let asyncCount = 0;
  let docstringCount = 0;
  const decoratorFrequency = new Map<string, number>();
  let tryExceptMentions = 0;

  for (const fn of fnNodes) {
    const md = (fn.metadata ?? {}) as Record<string, unknown>;
    const params = (md.parameters as string[] | undefined) ?? [];
    const returnHint = (md.returnHint as string | undefined) ?? "";
    const isAsync = Boolean(md.isAsync);
    const doc = (md.docstring as string | undefined) ?? "";
    const decorators = (md.decorators as string[] | undefined) ?? [];
    const code = (md.code as string | undefined) ?? "";

    if (params.some((p) => p.includes(":")) || returnHint) functionsWithAnyTypeHint++;
    if (isAsync) asyncCount++;
    if (doc && doc.trim().length > 0) docstringCount++;
    for (const d of decorators) {
      decoratorFrequency.set(d, (decoratorFrequency.get(d) ?? 0) + 1);
    }
    if (code.includes("try:") || code.includes("except ")) tryExceptMentions++;
  }

  const typeHintPct = toPct(functionsWithAnyTypeHint, fnNodes.length);
  const asyncPct = toPct(asyncCount, fnNodes.length);
  const docstringPct = toPct(docstringCount, fnNodes.length);

  const topDecorators = Array.from(decoratorFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");

  // Imports: approximate via edges from modules to external modules
  const importEdges = graph.edges.filter((e) => e.relation === "imports");
  const importCount = importEdges.length;

  // Build markdown
  const exampleFn = fnNodes.find((n) => n.label && extractFunctionBaseName(n.label));
  const exampleClass = classNodes[0];
  const exampleCode = codeSamples[0] ?? "";

  const lines: string[] = [];
  lines.push("# Codebase Conventions");
  lines.push("");
  lines.push("## Naming Conventions");
  lines.push("- **Functions**: snake_case (" + fnSnakePct + " adoption)");
  if (exampleFn) lines.push("  Example: `" + extractFunctionBaseName(exampleFn.label) + "`");
  lines.push("- **Classes**: PascalCase (" + classPascalPct + " adoption)");
  if (exampleClass) lines.push("  Example: `" + exampleClass.label + "`");
  lines.push(`- **Private methods**: leading underscore (${privatePct} adoption)`);
  lines.push("");

  lines.push("## Code Structure");
  lines.push(`- **Modules**: ${moduleNodes.length} modules detected`);
  lines.push(`- **Classes**: ${classNodes.length} classes detected`);
  lines.push(`- **Functions**: ${fnNodes.length} functions/methods detected`);
  lines.push("");

  lines.push("## Common Patterns");
  lines.push(`- **Decorators**: ${topDecorators || "None prominent"}`);
  lines.push(`- **Type hints**: ${typeHintPct} coverage`);
  lines.push(`- **Async/await**: ${asyncPct} usage`);
  lines.push(`- **Error handling**: try/except observed in ~${toPct(tryExceptMentions, fnNodes.length)} of functions`);
  lines.push("");

  lines.push("## Import Conventions");
  lines.push(`- ${importCount} import relations observed (module -> external module)`);
  lines.push("- Absolute vs relative import details not fully available; inferred from edges.");
  lines.push("");

  lines.push("## Documentation");
  lines.push(`- **Docstring coverage**: ${docstringPct}`);
  lines.push("");

  lines.push("## Recommendations");
  if (functionsWithAnyTypeHint < fnNodes.length) {
    lines.push("- Add missing type hints to functions lacking parameter or return types.");
  }
  if (asyncCount > 0 && tryExceptMentions === 0) {
    lines.push("- Ensure async functions include error handling where network/IO is used.");
  }
  if (docstringCount < fnNodes.length) {
    lines.push("- Increase docstring coverage for public functions and classes.");
  }
  if (!topDecorators) {
    lines.push("- Consider using decorators for cross-cutting concerns where appropriate.");
  }

  if (exampleCode) {
    lines.push("");
    lines.push("## Example Code Snippet");
    lines.push("```python");
    lines.push(truncate(exampleCode, 800));
    lines.push("```");
  }

  return lines.join("\n");
}

// ------------------------------
// Utilities
// ------------------------------

function collectCodeSamples(
  graph: KnowledgeGraph,
  extra: string[] | undefined,
  maxSamples: number,
  maxChars: number
): string[] {
  const samples: string[] = [];
  const fnNodes = graph.nodes.filter((n) => n.type === "function");
  const classNodes = graph.nodes.filter((n) => n.type === "class");

  // Prefer function/method code excerpts with docstrings, then others
  const prioritized: CodeNode[] = [
    ...fnNodes.filter((n) => hasNonEmptyString(n.metadata, "docstring") && hasNonEmptyString(n.metadata, "code")),
    ...fnNodes.filter((n) => hasNonEmptyString(n.metadata, "code")),
    ...classNodes.filter((n) => hasNonEmptyString(n.metadata, "code")),
  ];

  for (const n of prioritized) {
    const code = String(((n.metadata ?? {}) as Record<string, unknown>)["code"] ?? "");
    if (code && code.trim()) samples.push(code);
    if (samples.length >= maxSamples) break;
  }

  if (extra && extra.length) {
    for (const s of extra) {
      const t = (s ?? "").trim();
      if (t) samples.push(t);
      if (samples.length >= maxSamples) break;
    }
  }

  // Enforce total char limit
  let total = 0;
  const bounded: string[] = [];
  for (const s of samples) {
    const room = Math.max(0, maxChars - total);
    if (room <= 0) break;
    const chunk = s.length > room ? s.slice(0, room) : s;
    bounded.push(chunk);
    total += chunk.length;
  }
  return bounded;
}

function safeStringifyGraph(
  graph: KnowledgeGraph,
  limitNodes: number,
  limitEdges: number,
  maxChars: number
): string {
  const nodes = graph.nodes.slice(0, limitNodes).map((n) => simplifyNode(n));
  const edges = graph.edges.slice(0, limitEdges).map((e) => simplifyEdge(e));
  let s = JSON.stringify({ nodes, edges });
  if (s.length > maxChars) s = s.slice(0, maxChars) + "...";
  return s;
}

function simplifyNode(n: CodeNode) {
  return {
    id: n.id,
    label: n.label,
    type: n.type,
    line: n.line,
    metadata: simplifyMetadata(n.metadata),
  };
}

function simplifyEdge(e: CodeEdge) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    relation: e.relation,
    weight: (e.metadata as Record<string, unknown> | undefined)?.["weight"] ?? undefined,
  };
}

function simplifyMetadata(md: Record<string, unknown> | undefined) {
  if (!md) return undefined;
  const keep = ["module", "class", "parameters", "returnHint", "isAsync", "isPrivate", "decorators", "docstring"] as const;
  const out: Record<string, unknown> = {};
  for (const k of keep) {
    const v = (md as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function hasNonEmptyString(md: Record<string, unknown> | undefined, key: string): boolean {
  if (!md) return false;
  const v = (md as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim().length > 0;
}

function extractFunctionBaseName(label: string): string | undefined {
  // Labels for methods may be "ClassName.method"; use the method portion
  const parts = label.split(".");
  const name = parts[parts.length - 1];
  return name || undefined;
}

function toPct(numerator: number, denominator: number): string {
  if (!denominator || denominator <= 0) return "0%";
  const pct = Math.round((numerator / denominator) * 100);
  return `${pct}%`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

