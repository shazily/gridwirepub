import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type LineageNode = {
  id: string;
  node_type: string;
  label: string;
  metadata?: Record<string, unknown>;
};

type LineageEdge = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  relationship: string;
  metadata?: Record<string, unknown>;
};

const NODE_COLORS: Record<string, string> = {
  source_file: "#3b82f6",
  connector: "#8b5cf6",
  dataset: "#10b981",
  version: "#06b6d4",
  field: "#f59e0b",
  transform: "#ef4444",
  user: "#64748b",
  api_consumer: "#ec4899",
};

export function LineageGraph({
  nodes,
  edges,
}: {
  nodes: LineageNode[];
  edges: LineageEdge[];
}) {
  const initialNodes: Node[] = useMemo(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 120 },
        data: { label: `${n.label}\n(${n.node_type})` },
        style: {
          background: NODE_COLORS[n.node_type] ?? "#334155",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontSize: 12,
          padding: 8,
          whiteSpace: "pre-wrap",
          maxWidth: 180,
        },
      })),
    [nodes],
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.from_node_id,
        target: e.to_node_id,
        label: e.relationship.replace(/_/g, " "),
        animated: e.relationship === "type_changed",
      })),
    [edges],
  );

  const [flowNodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onInit = useCallback(() => {}, []);

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No lineage recorded yet. Publish a version to capture source → field → dataset flow.
      </p>
    );
  }

  return (
    <div className="h-[420px] w-full rounded-lg border border-border">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
