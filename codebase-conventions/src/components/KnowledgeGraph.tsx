"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Box, Stack, Typography, Divider, FormGroup, FormControlLabel, Checkbox, Drawer, Chip } from "@mui/material";
import ReactFlow, { Background, BackgroundVariant, Controls, MarkerType, Node as RFNode, Edge as RFEdge } from "reactflow";
import "reactflow/dist/style.css";
import type { KnowledgeGraph as TKnowledgeGraph, CodeNode as TCodeNode, CodeEdge as TCodeEdge } from "@/lib/types";

export interface KnowledgeGraphProps {
  graph?: TKnowledgeGraph;
  height?: number | string;
  // Optional filters to limit which nodes/edges are displayed
  filterModules?: string[];
  filterFilePaths?: string[];
}

type EdgeFilterKey = "imports" | "calls" | "inherits" | "uses" | "defines";

const NODE_COLORS: Record<string, { bg: string; border: string }> = {
  function: { bg: "#E3F2FD", border: "#1976d2" }, // blue
  class: { bg: "#E8F5E9", border: "#2e7d32" }, // green
  module: { bg: "#F3E5F5", border: "#6a1b9a" }, // purple
  variable: { bg: "#FFF3E0", border: "#ed6c02" }, // orange
};

const EDGE_COLORS: Record<EdgeFilterKey, string> = {
  imports: "#607d8b",
  calls: "#1976d2",
  inherits: "#9c27b0",
  uses: "#00897b",
  defines: "#ffb300",
};

export function KnowledgeGraph({ graph, height = "60vh", filterModules, filterFilePaths }: KnowledgeGraphProps) {
  const [filters, setFilters] = useState<Record<EdgeFilterKey, boolean>>({
    imports: true,
    calls: true,
    inherits: true,
    uses: true,
    defines: true,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(() => {
    if (!graph || !selectedNodeId) return undefined;
    return graph.nodes.find((n) => n.id === selectedNodeId);
  }, [graph, selectedNodeId]);

  const handleToggleFilter = (key: EdgeFilterKey) =>
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));

  const { nodes: rfNodes, edges: rfEdges } = useMemo(() => {
    if (!graph) return { nodes: [] as RFNode[], edges: [] as RFEdge[] };

    // Apply optional module/filePath filters first to get a display graph
    const filtersProvided = Boolean((filterModules && filterModules.length) || (filterFilePaths && filterFilePaths.length));
    const moduleSet = new Set((filterModules ?? []).map((m) => String(m)));
    const pathSet = new Set((filterFilePaths ?? []).map((p) => String(p)));

    const nodeAllowed = (node: TCodeNode): boolean => {
      if (!filtersProvided) return true;
      const md = (node.metadata || {}) as Record<string, unknown>;
      const moduleOf = (md.module as string) || (md.moduleName as string) || (node.label as string);
      const filePathOf = (node.filePath as string | undefined) ?? undefined;

      const moduleOk = moduleSet.size === 0 || (moduleOf && moduleSet.has(moduleOf));
      const pathOk = pathSet.size === 0 || (filePathOf && pathSet.has(filePathOf));
      // If both filters present, require both to match; if only one present, require that one
      if (moduleSet.size > 0 && pathSet.size > 0) return Boolean(moduleOk && pathOk);
      if (moduleSet.size > 0) return Boolean(moduleOk);
      if (pathSet.size > 0) return Boolean(pathOk);
      return true;
    };

    const allowedIds = new Set<string>();
    for (const n of graph.nodes) {
      if (nodeAllowed(n)) allowedIds.add(n.id);
    }
    const displayNodes = filtersProvided ? graph.nodes.filter((n) => allowedIds.has(n.id)) : graph.nodes;
    const displayEdges = filtersProvided
      ? graph.edges.filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target))
      : graph.edges;

    // Build layout: group by module, layers per type
    const HSPACE = 220;
    const VSPACE = 140;
    const GROUP_GAP = 120;

    function isExternal(node: TCodeNode): boolean {
      return Boolean((node.metadata as any)?.external);
    }

    function moduleKeyOf(node: TCodeNode): string {
      if (isExternal(node)) return "__external__";
      if (node.type === "module") return String(node.label);
      const md = (node.metadata || {}) as Record<string, unknown>;
      const moduleName = (md.module as string) || (md.moduleName as string);
      return moduleName || "__unknown__";
    }

    const modules: string[] = [];
    const seen = new Set<string>();
    for (const n of displayNodes) {
      if (n.type === "module" && !isExternal(n)) {
        const key = moduleKeyOf(n);
        if (!seen.has(key)) {
          seen.add(key);
          modules.push(key);
        }
      }
    }
    // Ensure we include nodes even if no explicit module node exists
    for (const n of displayNodes) {
      const key = moduleKeyOf(n);
      if (key !== "__external__" && key !== "__unknown__" && !seen.has(key)) {
        seen.add(key);
        modules.push(key);
      }
    }

    const groups: Record<string, { [layer: number]: TCodeNode[] }> = {};
    function layerOf(node: TCodeNode): number {
      if (node.type === "module") return 0;
      if (node.type === "class") return 1;
      if (node.type === "function") return 2;
      if (node.type === "variable") return 3;
      return 4;
    }
    for (const n of displayNodes) {
      const key = moduleKeyOf(n);
      const groupKey = key === "__external__" ? "__external__" : key;
      const layer = groupKey === "__external__" ? 0 : layerOf(n);
      if (!groups[groupKey]) groups[groupKey] = {};
      if (!groups[groupKey][layer]) groups[groupKey][layer] = [];
      groups[groupKey][layer].push(n);
    }

    const order: string[] = [...modules];
    if (groups["__external__"]) order.push("__external__");

    // Compute positions
    const positions = new Map<string, { x: number; y: number }>();
    let xCursor = 0;
    for (const gKey of order) {
      const layers = groups[gKey] || {};
      const layerIndices = Object.keys(layers)
        .map((k) => Number(k))
        .sort((a, b) => a - b);
      const maxPerLayer = Math.max(1, ...layerIndices.map((li) => layers[li]?.length || 0));
      const groupWidth = Math.max(1, maxPerLayer) * HSPACE;
      for (const li of layerIndices) {
        const arr = layers[li];
        if (!arr || arr.length === 0) continue;
        const total = arr.length;
        const rowY = li * VSPACE;
        const startX = xCursor + (groupWidth - (total - 1) * HSPACE) / 2;
        for (let i = 0; i < total; i += 1) {
          const node = arr[i];
          positions.set(node.id, { x: startX + i * HSPACE, y: rowY });
        }
      }
      xCursor += groupWidth + GROUP_GAP;
    }

    // Map nodes
    const rfNodesLocal: RFNode[] = displayNodes.map((n) => {
      const pos = positions.get(n.id) || { x: 0, y: 0 };
      const palette = NODE_COLORS[n.type] || { bg: "#ECEFF1", border: "#546e7a" };
      const external = isExternal(n);
      return {
        id: n.id,
        position: pos,
        data: { label: n.label },
        type: "default",
        style: {
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          borderStyle: external ? "dashed" : "solid",
          borderRadius: 8,
          padding: 8,
          fontSize: 12,
          width: 180,
        },
        draggable: false,
      } satisfies RFNode;
    });

    // Map edges with filters and colors
    const rfEdgesLocal: RFEdge[] = displayEdges
      .filter((e) => (filters as any)[e.relation as EdgeFilterKey] !== false)
      .map((e) => {
        const rel = e.relation as EdgeFilterKey;
        const color = EDGE_COLORS[rel] || "#78909c";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: rel === "calls",
          style: { stroke: color, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        } satisfies RFEdge;
      });

    return { nodes: rfNodesLocal, edges: rfEdgesLocal };
  }, [graph, filters]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    setSelectedNodeId(node.id);
  }, []);

  return (
    <Stack spacing={1} sx={{ height }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="subtitle2">Edges:</Typography>
        <FormGroup row>
          {(["imports", "calls", "inherits", "uses", "defines"] as EdgeFilterKey[]).map((k) => (
            <FormControlLabel
              key={k}
              control={<Checkbox size="small" checked={filters[k]} onChange={() => handleToggleFilter(k)} />}
              label={k}
            />
          ))}
        </FormGroup>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 320, border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        <ReactFlow nodes={rfNodes} edges={rfEdges} onNodeClick={onNodeClick} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable>
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls position="bottom-right" />
        </ReactFlow>
      </Box>

      <Drawer anchor="right" open={Boolean(selectedNode)} onClose={() => setSelectedNodeId(null)}>
        <Box sx={{ width: 420, p: 2 }} role="presentation">
          {selectedNode ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h6" sx={{ mr: 1 }}>
                  {selectedNode.label}
                </Typography>
                <Chip size="small" label={String(selectedNode.type).toUpperCase()} />
                {selectedNode.filePath && (
                  <Typography variant="caption" color="text.secondary">
                    {selectedNode.filePath}
                    {selectedNode.line ? `:${selectedNode.line}` : ""}
                  </Typography>
                )}
              </Stack>
              <Divider />
              {(() => {
                const md = (selectedNode.metadata || {}) as Record<string, unknown>;
                const rows: [string, string][] = [];
                const pushIf = (label: string, val?: unknown) => {
                  if (val === undefined || val === null) return;
                  if (Array.isArray(val)) rows.push([label, val.join(", ")]);
                  else rows.push([label, String(val)]);
                };
                pushIf("Module", (md.module as string) || (md.moduleName as string));
                pushIf("Class", md.class);
                pushIf("Return", md.returnHint);
                pushIf("Parameters", md.parameters);
                pushIf("Decorators", md.decorators);
                pushIf("Bases", md.baseClasses);
                pushIf("Private", md.isPrivate);
                pushIf("Async", md.isAsync);
                const doc = md.docstring as string | undefined;
                const code = (md.code as string | undefined) || (md.codeExcerpt as string | undefined);
                return (
                  <Stack spacing={1.5}>
                    {rows.length > 0 && (
                      <Box>
                        {rows.map(([k, v]) => (
                          <Stack key={k} direction="row" spacing={1}>
                            <Typography variant="body2" sx={{ minWidth: 96, color: "text.secondary" }}>
                              {k}
                            </Typography>
                            <Typography variant="body2">{v}</Typography>
                          </Stack>
                        ))}
                      </Box>
                    )}
                    {doc && (
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          Docstring
                        </Typography>
                        <Box component="pre" sx={{ m: 0, p: 1, bgcolor: "action.hover", borderRadius: 1, whiteSpace: "pre-wrap" }}>
                          {doc}
                        </Box>
                      </Box>
                    )}
                    {code && (
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          Code
                        </Typography>
                        <Box component="pre" sx={{ m: 0, p: 1, bgcolor: "action.hover", borderRadius: 1, overflow: "auto", maxHeight: 400 }}>
                          {code}
                        </Box>
                      </Box>
                    )}
                  </Stack>
                );
              })()}
            </Stack>
          ) : (
            <Typography variant="body2">No node selected</Typography>
          )}
        </Box>
      </Drawer>
    </Stack>
  );
}

export default KnowledgeGraph;

