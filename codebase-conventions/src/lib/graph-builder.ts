import type { KnowledgeGraph, CodeNode, CodeEdge } from "@/lib/types";

export function buildKnowledgeGraph(nodes: CodeNode[] = [], edges: CodeEdge[] = []): KnowledgeGraph {
  return { nodes, edges };
}

export default buildKnowledgeGraph;

