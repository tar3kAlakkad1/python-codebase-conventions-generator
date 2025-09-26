import type {
  UploadedFile,
  ParseOptions,
  ParseResult,
  ParsedModule,
  ParsedFunction,
  ParsedClass,
  ParsedImport,
  ParsedVariable,
  ParsedCall,
} from "@/lib/types";

/**
 * Regex-first Python parser (MVP):
 * - Extracts classes, functions, imports, top-level variables, and basic call sites.
 * - Tracks line numbers (1-based) and best-effort code excerpts.
 */
export async function parsePythonFiles(files: UploadedFile[], options?: ParseOptions): Promise<ParseResult> {
  const includeDocstrings = options?.includeDocstrings ?? true;

  return files.map((file) => parseSingleFile(file, { includeDocstrings }));
}

export default parsePythonFiles;

function parseSingleFile(file: UploadedFile, opts: { includeDocstrings: boolean }): ParsedModule {
  const filePath = file.path ?? file.name;
  const moduleName = deriveModuleName(file.name);
  const content = file.content.replace(/\r\n?/g, "\n");
  const lines = content.split("\n");

  const imports: ParsedImport[] = parseImports(lines);
  const { classes, functions } = parseClassesAndFunctions(lines, opts);
  const variables: ParsedVariable[] = parseTopLevelVariables(lines);

  return {
    filePath,
    moduleName,
    classes,
    functions,
    imports,
    variables,
  } satisfies ParsedModule;
}

function deriveModuleName(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
  return base.endsWith(".py") ? base.slice(0, -3) : base;
}

function getIndent(s: string): string {
  const match = s.match(/^[\t ]*/);
  return match ? match[0] : "";
}

function trimRightMax(s: string, maxLen = 120): string {
  const t = s.trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen) + "…";
}

function parseImports(lines: string[]): ParsedImport[] {
  const results: ParsedImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // from x.y import a as b, c
    let m = line.match(/^\s*from\s+([\w\.]+)\s+import\s+(.+)$/);
    if (m) {
      const moduleName = m[1];
      const rhs = m[2].split(",").map((t) => t.trim());
      const names = rhs
        .filter((t) => t.length > 0)
        .map((t) => {
          const asMatch = t.match(/^([\w\.]+)\s+as\s+([\w_]+)$/);
          if (asMatch) return { name: asMatch[1], alias: asMatch[2] };
          return { name: t };
        });
      results.push({ importType: "from", module: moduleName, names, line: i + 1, code: trimmed });
      continue;
    }

    // import a as b, c.d
    m = line.match(/^\s*import\s+(.+)$/);
    if (m) {
      const rhs = m[1].split(",").map((t) => t.trim());
      const names = rhs
        .filter((t) => t.length > 0)
        .map((t) => {
          const asMatch = t.match(/^([\w\.]+)\s+as\s+([\w_]+)$/);
          if (asMatch) return { name: asMatch[1], alias: asMatch[2] };
          return { name: t };
        });
      const moduleName = names.length > 0 ? names[0].name : "";
      results.push({ importType: "import", module: moduleName, names, line: i + 1, code: trimmed });
      continue;
    }
  }
  return results;
}

function parseTopLevelVariables(lines: string[]): ParsedVariable[] {
  const vars: ParsedVariable[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = getIndent(line);
    if (indent.length !== 0) continue; // top-level only
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Simple assignment: NAME = value (avoid ==, >=, etc.)
    const m = line.match(/^([\t ]*)([A-Za-z_]\w*)\s*=\s*([^=].*)$/);
    if (m) {
      const name = m[2];
      const valueSnippet = trimRightMax(m[3]);
      vars.push({ name, valueSnippet, line: i + 1 });
    }
  }
  return vars;
}

function parseClassesAndFunctions(
  lines: string[],
  opts: { includeDocstrings: boolean }
): { classes: ParsedClass[]; functions: ParsedFunction[] } {
  const classes: ParsedClass[] = [];
  const functions: ParsedFunction[] = [];

  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      i++;
      continue;
    }

    // Gather decorators directly above the target (contiguous block)
    const decorators: string[] = [];
    let decIndex = i;
    while (decIndex < n) {
      const t = lines[decIndex].trim();
      if (t.startsWith("@")) {
        decorators.push(t);
        decIndex++;
      } else if (t === "") {
        // allow blank within decorator block
        decorators.push(t);
        decIndex++;
      } else {
        break;
      }
    }
    if (decorators.length > 0) {
      // Reset i to the first non-decorator line after the decorator block
      i = decIndex;
    }

    if (i >= n) break;

    const curr = lines[i];
    const indent = getIndent(curr);

    // class
    const mClass = curr.match(/^(\t|\s)*class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?\s*:/);
    if (mClass) {
      const classIndentLen = indent.length;
      const name = mClass[2];
      const baseClasses = (mClass[3] ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const classDecorators = (decorators.filter((d) => d.startsWith("@")) as string[]) ?? [];
      const lineStart = i + 1;
      const blockEnd = findBlockEnd(lines, i, classIndentLen);

      const { docstring, firstBodyLine } = extractDocstringIfFirst(lines, i, blockEnd, classIndentLen, opts.includeDocstrings);

      // Methods inside class
      const methods: ParsedFunction[] = [];
      const bodyStart = Math.min(blockEnd, firstBodyLine);
      let j = bodyStart;
      while (j <= blockEnd) {
        // Collect method decorators
        const methodDecos: string[] = [];
        let k = j;
        while (k <= blockEnd) {
          const t = lines[k].trim();
          if (t.startsWith("@")) {
            methodDecos.push(t);
            k++;
          } else if (t === "") {
            methodDecos.push(t);
            k++;
          } else {
            break;
          }
        }
        if (k > blockEnd) break;

        const methodLine = lines[k];
        const methodIndent = getIndent(methodLine);
        const mDef = methodLine.match(/^(\t|\s)*(async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/);
        if (mDef && methodIndent.length > classIndentLen) {
          const isAsync = !!mDef[2];
          const methodName = mDef[3];
          const paramsRaw = mDef[4] ?? "";
          const returnHint = (mDef[5] ?? "").trim() || undefined;
          const isPrivate = methodName.startsWith("_");
          const methodStartIdx = k;
          const methodEndIdx = findBlockEnd(lines, methodStartIdx, methodIndent.length);
          const { docstring: methodDoc, firstBodyLine: methodFirstBody } = extractDocstringIfFirst(
            lines,
            methodStartIdx,
            methodEndIdx,
            methodIndent.length,
            opts.includeDocstrings
          );
          const codeExcerpt = sliceLines(lines, methodStartIdx, methodEndIdx);
          const parameters = splitParams(paramsRaw);
          const calls = extractCalls(lines, methodFirstBody, methodEndIdx);
          methods.push({
            name: methodName,
            parameters,
            returnHint,
            isAsync,
            isPrivate,
            decorators: methodDecos.filter((d) => d.startsWith("@")) as string[],
            lineStart: methodStartIdx + 1,
            lineEnd: methodEndIdx + 1,
            docstring: methodDoc,
            codeExcerpt,
            calls,
          });
          j = methodEndIdx + 1;
          continue;
        }
        j = k + 1;
      }

      const codeExcerpt = sliceLines(lines, i, blockEnd);
      classes.push({
        name,
        baseClasses,
        decorators: classDecorators,
        docstring,
        lineStart,
        lineEnd: blockEnd + 1,
        codeExcerpt,
        methods,
      });

      i = blockEnd + 1;
      continue;
    }

    // top-level function
    const mFun = curr.match(/^(\t|\s)*(async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/);
    if (mFun) {
      const indentLen = getIndent(curr).length;
      const isAsync = !!mFun[2];
      const name = mFun[3];
      const paramsRaw = mFun[4] ?? "";
      const returnHint = (mFun[5] ?? "").trim() || undefined;
      const isPrivate = name.startsWith("_");
      const startIdx = i;
      const endIdx = findBlockEnd(lines, startIdx, indentLen);
      const { docstring, firstBodyLine } = extractDocstringIfFirst(lines, startIdx, endIdx, indentLen, opts.includeDocstrings);
      const codeExcerpt = sliceLines(lines, startIdx, endIdx);
      const parameters = splitParams(paramsRaw);
      const calls = extractCalls(lines, firstBodyLine, endIdx);
      functions.push({
        name,
        parameters,
        returnHint,
        isAsync,
        isPrivate,
        decorators: decorators.filter((d) => d.startsWith("@")) as string[],
        lineStart: startIdx + 1,
        lineEnd: endIdx + 1,
        docstring,
        codeExcerpt,
        calls,
      });
      i = endIdx + 1;
      continue;
    }

    i++;
  }

  return { classes, functions };
}

function findBlockEnd(lines: string[], startIdx: number, defIndentLen: number): number {
  const n = lines.length;
  let end = startIdx;
  for (let i = startIdx + 1; i < n; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      end = i; // include trailing blank/comment
      continue;
    }
    const indentLen = getIndent(line).length;
    if (indentLen <= defIndentLen) {
      return end;
    }
    end = i;
  }
  return end;
}

function extractDocstringIfFirst(
  lines: string[],
  startIdx: number,
  endIdx: number,
  defIndentLen: number,
  includeDocstrings: boolean
): { docstring?: string; firstBodyLine: number } {
  const firstBodyLine = startIdx + 1;
  if (!includeDocstrings) {
    return { firstBodyLine };
  }

  // find the first non-blank line with indent > defIndentLen
  let i = startIdx + 1;
  while (i <= endIdx) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indentLen = getIndent(line).length;
    if (indentLen <= defIndentLen) {
      // out of body; no docstring
      return { firstBodyLine: i };
    }
    // Potential docstring line
    const triple = trimmed.match(/^[ruRU]{0,2}("""|''')/);
    if (triple) {
      const quote = triple[1];
      // If docstring ends on same line
      const closingSameLine = trimmed.slice(triple.index! + triple[0].length).includes(quote);
      if (closingSameLine) {
        const inner = trimmed
          .slice(trimmed.indexOf(quote)! + quote.length)
          .replace(new RegExp(`${quote}.*$`), "")
          .trim();
        return { docstring: inner, firstBodyLine: i + 1 };
      }
      // Multi-line docstring
      const { value, endLine } = captureMultilineString(lines, i, quote);
      return { docstring: value, firstBodyLine: endLine + 1 };
    }
    // Not a docstring; body begins here
    return { firstBodyLine: i };
  }
  return { firstBodyLine: Math.min(endIdx + 1, lines.length - 1) };
}

function captureMultilineString(
  lines: string[],
  startIdx: number,
  quote: string
): { value: string; endLine: number } {
  const n = lines.length;
  const startLine = lines[startIdx];
  const startPos = startLine.indexOf(quote);
  let value = startLine.slice(startPos + quote.length) + "\n";
  for (let i = startIdx + 1; i < n; i++) {
    const line = lines[i];
    const pos = line.indexOf(quote);
    if (pos >= 0) {
      value += line.slice(0, pos);
      return { value: value.trim(), endLine: i };
    }
    value += line + "\n";
  }
  return { value: value.trim(), endLine: n - 1 };
}

function splitParams(paramsRaw: string): string[] {
  const s = paramsRaw.trim();
  if (s === "") return [];
  // naive split by comma; does not handle nested parens or defaults with commas
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

const KEYWORD_CALL_DENYLIST = new Set([
  "if",
  "for",
  "while",
  "with",
  "return",
  "yield",
  "raise",
  "except",
  "class",
  "def",
  "await",
  "lambda",
  "try",
  "assert",
  "del",
  "global",
  "nonlocal",
  "pass",
  "break",
  "continue",
]);

function extractCalls(lines: string[], startIdx: number, endIdx: number): ParsedCall[] {
  const calls: ParsedCall[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    if (i < 0 || i >= lines.length) break;
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    // Find identifiers followed by '('
    const re = /([A-Za-z_][\w\.]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      const base = name.includes(".") ? name.split(".")[0] : name;
      if (KEYWORD_CALL_DENYLIST.has(base)) continue;
      calls.push({ name, line: i + 1, column: m.index + 1, qualified: name });
    }
  }
  return calls;
}

function sliceLines(lines: string[], startIdx: number, endIdx: number): string {
  const start = Math.max(0, startIdx);
  const end = Math.min(lines.length - 1, endIdx);
  return lines.slice(start, end + 1).join("\n");
}

