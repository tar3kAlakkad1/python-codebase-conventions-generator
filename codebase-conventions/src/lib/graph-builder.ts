import type {
  KnowledgeGraph,
  CodeNode,
  CodeEdge,
  ParsedModule,
  ParsedFunction,
  ParseResult,
} from "@/lib/types";

type EdgeKey = string;

/**
 * Build a deterministic KnowledgeGraph from ParsedModule[]
 * - Node IDs are globally unique using `${module}:${type}:${name}:${line}` (methods use `${class}.${method}`)
 * - Relations: imports, calls, inherits, uses, defines
 * - Deduplicates nodes/edges and tracks edge weights (metadata.weight)
 */
export function buildKnowledgeGraphFromParsedModules(parsed: ParseResult | ParsedModule[]): KnowledgeGraph {
  const modules = parsed as ParsedModule[];

  const nodeById = new Map<string, CodeNode>();
  const edgeWeightByKey = new Map<EdgeKey, number>();

  // Indexes for resolution
  const topLevelFuncByModuleAndName = new Map<string, string>(); // key: `${module}::${name}` -> nodeId
  const classByModuleAndName = new Map<string, string>(); // key: `${module}::${class}` -> nodeId
  const methodByModuleClassAndName = new Map<string, string>(); // key: `${module}::${class}::${method}` -> nodeId

  // Helper: ensure node exists
  function upsertNode(node: CodeNode): CodeNode {
    const existing = nodeById.get(node.id);
    if (!existing) {
      nodeById.set(node.id, node);
      return node;
    }
    // merge metadata shallowly, preferring existing defined values
    const merged: CodeNode = {
      ...existing,
      label: existing.label || node.label,
      type: existing.type || node.type,
      filePath: existing.filePath || node.filePath,
      line: existing.line ?? node.line,
      column: existing.column ?? node.column,
      metadata: { ...(node.metadata ?? {}), ...(existing.metadata ?? {}) },
    };
    nodeById.set(node.id, merged);
    return merged;
  }

  function addEdge(source: string, relation: string, target: string, extra?: Record<string, unknown>) {
    const key = `${source}|${relation}|${target}`;
    const prev = edgeWeightByKey.get(key) ?? 0;
    edgeWeightByKey.set(key, prev + 1);
  }

  function moduleNodeId(moduleName: string): string {
    return `${moduleName}:module:${moduleName}:1`;
  }

  function classNodeId(moduleName: string, className: string, line: number): string {
    return `${moduleName}:class:${className}:${line}`;
  }

  function functionNodeId(moduleName: string, name: string, line: number): string {
    return `${moduleName}:function:${name}:${line}`;
  }

  function variableNodeId(moduleName: string, name: string, line: number): string {
    return `${moduleName}:variable:${name}:${line}`;
  }

  function externalModuleNodeId(moduleName: string): string {
    return `external:module:${moduleName}:0`;
  }

  function externalFunctionNodeId(qualified: string): string {
    return `external:function:${qualified}:0`;
  }

  function ensureModuleNode(mod: ParsedModule): CodeNode {
    const id = moduleNodeId(mod.moduleName);
    return upsertNode({
      id,
      label: mod.moduleName,
      type: "module",
      filePath: mod.filePath,
      line: 1,
      metadata: { moduleName: mod.moduleName },
    });
  }

  // Pre-pass: create nodes for modules, classes, functions/methods, variables; build resolution indexes
  for (const mod of modules) {
    const modNode = ensureModuleNode(mod);

    // Classes and methods
    for (const cls of mod.classes) {
      const clsId = classNodeId(mod.moduleName, cls.name, cls.lineStart);
      upsertNode({
        id: clsId,
        label: cls.name,
        type: "class",
        filePath: mod.filePath,
        line: cls.lineStart,
        metadata: {
          module: mod.moduleName,
          baseClasses: cls.baseClasses,
          decorators: cls.decorators,
          docstring: cls.docstring,
          code: cls.codeExcerpt,
        },
      });
      classByModuleAndName.set(`${mod.moduleName}::${cls.name}`, clsId);
      addEdge(modNode.id, "defines", clsId);

      for (const m of cls.methods) {
        const qualifiedName = `${cls.name}.${m.name}`;
        const fnId = functionNodeId(mod.moduleName, qualifiedName, m.lineStart);
        upsertNode({
          id: fnId,
          label: qualifiedName,
          type: "function",
          filePath: mod.filePath,
          line: m.lineStart,
          metadata: {
            module: mod.moduleName,
            class: cls.name,
            parameters: m.parameters,
            returnHint: m.returnHint,
            isAsync: m.isAsync,
            isPrivate: m.isPrivate,
            decorators: m.decorators,
            docstring: m.docstring,
            code: m.codeExcerpt,
          },
        });
        methodByModuleClassAndName.set(`${mod.moduleName}::${cls.name}::${m.name}`, fnId);
        addEdge(clsId, "defines", fnId);
      }
    }

    // Top-level functions
    for (const fn of mod.functions) {
      const fnId = functionNodeId(mod.moduleName, fn.name, fn.lineStart);
      upsertNode({
        id: fnId,
        label: fn.name,
        type: "function",
        filePath: mod.filePath,
        line: fn.lineStart,
        metadata: {
          module: mod.moduleName,
          parameters: fn.parameters,
          returnHint: fn.returnHint,
          isAsync: fn.isAsync,
          isPrivate: fn.isPrivate,
          decorators: fn.decorators,
          docstring: fn.docstring,
          code: fn.codeExcerpt,
        },
      });
      topLevelFuncByModuleAndName.set(`${mod.moduleName}::${fn.name}`, fnId);
      addEdge(modNode.id, "defines", fnId);
    }

    // Variables
    for (const v of mod.variables) {
      const varId = variableNodeId(mod.moduleName, v.name, v.line);
      upsertNode({
        id: varId,
        label: v.name,
        type: "variable",
        filePath: mod.filePath,
        line: v.line,
        metadata: {
          module: mod.moduleName,
          valueSnippet: v.valueSnippet,
        },
      });
      addEdge(modNode.id, "defines", varId);
    }
  }

  // Build import alias maps per module and create import edges
  for (const mod of modules) {
    const modNodeIdVal = moduleNodeId(mod.moduleName);
    const aliasToQualified = new Map<string, string>();
    const importedModules = new Set<string>();

    for (const imp of mod.imports) {
      if (imp.importType === "import") {
        for (const n of imp.names) {
          const raw = n.name; // may contain dots
          const asName = n.alias ?? raw.split(".")[0];
          aliasToQualified.set(asName, raw);
          importedModules.add(raw.split(".")[0]);
        }
      } else if (imp.importType === "from") {
        for (const n of imp.names) {
          const sym = n.alias ?? n.name;
          aliasToQualified.set(sym, `${imp.module}.${n.name}`);
        }
        importedModules.add(imp.module.split(".")[0]);
      }
    }

    // Create module-level import edges to external module nodes
    for (const mName of importedModules) {
      const extModId = externalModuleNodeId(mName);
      upsertNode({ id: extModId, label: mName, type: "module", metadata: { external: true } });
      addEdge(modNodeIdVal, "imports", extModId);
    }

    // Attach the alias map to the module's module node metadata for later reference (optional)
    const modNode = nodeById.get(modNodeIdVal);
    if (modNode) {
      modNodeByIdSetMetadata(modNode, { importAliases: Object.fromEntries(aliasToQualified) });
      nodeById.set(modNodeIdVal, modNode);
    }

    // Calls and uses edges
    for (const fn of mod.functions) {
      linkCallsForFunction(mod, fn, /*withinClass*/ undefined, aliasToQualified);
    }
    for (const cls of mod.classes) {
      for (const m of cls.methods) {
        linkCallsForFunction(mod, m, cls.name, aliasToQualified);
      }
    }

    // Inheritance edges (base -> derived)
    for (const cls of mod.classes) {
      const derivedId = classByModuleAndName.get(`${mod.moduleName}::${cls.name}`);
      if (!derivedId) continue;
      for (const base of cls.baseClasses) {
        // Prefer same-module first, then any-module by class name, else external class
        const sameModuleBaseId = classByModuleAndName.get(`${mod.moduleName}::${base}`);
        const baseId = sameModuleBaseId ?? findClassByNameAnyModule(base) ?? externalClass(base);
        addEdge(baseId, "inherits", derivedId);
      }
    }
  }

  // Materialize edges
  const edges: CodeEdge[] = Array.from(edgeWeightByKey.entries()).map(([key, weight]) => {
    const [source, relation, target] = key.split("|");
    return {
      id: key,
      source,
      target,
      relation,
      metadata: { weight },
    };
  });

  // Sort nodes and edges deterministically
  const nodes = Array.from(nodeById.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { nodes, edges };

  // Helpers
  function modNodeByIdSetMetadata(node: CodeNode, md: Record<string, unknown>) {
    node.metadata = { ...(node.metadata ?? {}), ...md };
  }

  function findClassByNameAnyModule(className: string): string | undefined {
    for (const [k, id] of classByModuleAndName.entries()) {
      if (k.endsWith(`::${className}`)) return id;
    }
    return undefined;
  }

  function externalClass(className: string): string {
    const id = `external:class:${className}:0`;
    upsertNode({ id, label: className, type: "class", metadata: { external: true } });
    return id;
    }

  function linkCallsForFunction(
    mod: ParsedModule,
    fn: ParsedFunction,
    withinClass: string | undefined,
    aliasToQualified: Map<string, string>
  ) {
    const sourceId = withinClass
      ? methodByModuleClassAndName.get(`${mod.moduleName}::${withinClass}::${fn.name}`)
      : topLevelFuncByModuleAndName.get(`${mod.moduleName}::${fn.name}`);
    if (!sourceId) return;

    for (const c of fn.calls) {
      const name = c.name;
      if (name.includes(".")) {
        const [base, ...rest] = name.split(".");
        const methodName = rest[rest.length - 1];

        if (base === "self" || base === "cls") {
          // Method on same class
          if (withinClass) {
            const targetId = methodByModuleClassAndName.get(`${mod.moduleName}::${withinClass}::${methodName}`);
            if (targetId) {
              addEdge(sourceId, "calls", targetId);
              continue;
            }
          }
          // Fallback external if not resolved
          const extId = externalFunctionNodeId(methodName);
          upsertNode({ id: extId, label: methodName, type: "function", metadata: { external: true } });
          addEdge(sourceId, "uses", extId);
          continue;
        }

        // Base may be a class in same module
        const classTargetId = classByModuleAndName.get(`${mod.moduleName}::${base}`);
        if (classTargetId) {
          const methTargetId = methodByModuleClassAndName.get(`${mod.moduleName}::${base}::${methodName}`);
          if (methTargetId) {
            addEdge(sourceId, "calls", methTargetId);
            continue;
          }
        }

        // Base may be an imported alias: treat as external use
        const qualified = aliasToQualified.get(base) ?? name;
        const extId = externalFunctionNodeId(qualified);
        upsertNode({ id: extId, label: qualified, type: "function", metadata: { external: true } });
        addEdge(sourceId, "uses", extId);
        continue;
      }

      // Simple function name
      const sameModuleFn = topLevelFuncByModuleAndName.get(`${mod.moduleName}::${name}`);
      if (sameModuleFn) {
        addEdge(sourceId, "calls", sameModuleFn);
        continue;
      }

      if (withinClass) {
        const sameClassMethod = methodByModuleClassAndName.get(`${mod.moduleName}::${withinClass}::${name}`);
        if (sameClassMethod) {
          addEdge(sourceId, "calls", sameClassMethod);
          continue;
        }
      }

      // If imported symbol exists with same alias, consider external use
      const qualified = aliasToQualified.get(name);
      if (qualified) {
        const extId = externalFunctionNodeId(qualified);
        upsertNode({ id: extId, label: qualified, type: "function", metadata: { external: true } });
        addEdge(sourceId, "uses", extId);
        continue;
      }

      // Otherwise, unknown - treat as external function symbol by simple name
      const extId = externalFunctionNodeId(name);
      upsertNode({ id: extId, label: name, type: "function", metadata: { external: true } });
      addEdge(sourceId, "uses", extId);
    }
  }
}

/**
 * Lightweight helper that simply wraps nodes/edges in a graph.
 * Provided for API parity and testing convenience.
 */
export function buildKnowledgeGraph(nodes: CodeNode[] = [], edges: CodeEdge[] = []): KnowledgeGraph {
  // Deterministic ordering
  const sortedNodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedEdges = [...edges].map((e) => ({
    ...e,
    id: e.id || `${e.source}|${e.relation}|${e.target}`,
  })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes: sortedNodes, edges: sortedEdges };
}

/**
 * Stable JSON export for a KnowledgeGraph.
 */
export function toGraphJson(graph: KnowledgeGraph): string {
  const nodes = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = [...graph.edges].map((e) => ({
    ...e,
    id: e.id || `${e.source}|${e.relation}|${e.target}`,
  })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ nodes, edges }, null, 2);
}

export default buildKnowledgeGraphFromParsedModules;

