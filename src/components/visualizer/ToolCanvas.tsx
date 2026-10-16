/**
 * ToolCanvas — the 3D DAG of real tool calls.
 *
 * Imported lazily via next/dynamic (ssr: false) so three.js can never
 * break the chat, even if WebGL is missing. Wrapped in an error boundary
 * by the parent.
 *
 * Honesty rules, enforced by construction:
 * - One node per real `tool_call_start` event, in call order. Nothing else
 *   creates nodes.
 * - A node pulses ONLY while its tool call is active (status === "active"
 *   from a real start with no end yet). Settled nodes are still.
 * - Edges connect consecutive real calls — the actual execution order.
 * - Deterministic horizontal layout; no force-directed chaos.
 * - frameloop="demand": no always-running animation loop. Frames render
 *   on state change, and the pulse loop runs only while a node is active.
 *
 * Aesthetic: a calm instrument, not a sci-fi console. Matte plates, one
 * soft key light, muted status colors, essentially still when idle.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
// Deep imports: the drei barrel pulls in unrelated modules (e.g. hls.js),
// ballooning the lazy chunk. These paths are stable in drei 10.x.
import { Html } from "@react-three/drei/web/Html.js";
import { Line } from "@react-three/drei/core/Line.js";
import { RoundedBox } from "@react-three/drei/core/RoundedBox.js";
import type { ToolNodeView } from "./nodeState";
import { CLUSTER_ID } from "./nodeState";

interface Props {
  /** Nodes to draw individually, in call order. */
  nodes: ToolNodeView[];
  /** Older nodes collapsed into the cluster (0 = none). */
  collapsedCount: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const STATUS_COLOR: Record<ToolNodeView["status"], string> = {
  active: "#d97706", // amber-600
  success: "#0f766e", // teal-700
  failed: "#b91c1c", // red-700
};

const NODE_SPACING = 1.75;

/** Positions: deterministic horizontal pipeline, centered on origin. */
function layout(count: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < count; i++) {
    xs.push((i - (count - 1) / 2) * NODE_SPACING);
  }
  return xs;
}

/** Gentle pulse, ONLY while the tool call is active. */
function Pulse({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (active) {
      invalidate();
    }
  }, [active, invalidate]);

  useFrame((state) => {
    if (!active || !ref.current) {
      return;
    }
    const t = state.clock.elapsedTime;
    ref.current.scale.setScalar(1 + Math.sin(t * 2.8) * 0.05);
    state.invalidate(); // keep the loop alive only while active
  });

  return <group ref={ref}>{children}</group>;
}

/** Re-render one demand frame whenever the visual state changes. */
function DemandInvalidator({ depKey }: { depKey: string }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [depKey, invalidate]);
  return null;
}

function ToolNode({
  node,
  position,
  selected,
  focused,
  onSelect,
}: {
  node: ToolNodeView;
  position: [number, number, number];
  selected: boolean;
  focused: boolean;
  onSelect: (id: string) => void;
}) {
  const color = STATUS_COLOR[node.status];
  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect(node.id);
    },
    [node.id, onSelect],
  );

  return (
    <group position={position}>
      <Pulse active={node.status === "active"}>
        {/* R3F disposes JSX-created geometries/materials on unmount. */}
        <RoundedBox
          args={[1.2, 0.64, 0.16]}
          radius={0.08}
          smoothness={4}
          onClick={handleClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "auto";
          }}
        >
          <meshStandardMaterial
            color={selected ? "#ffffff" : "#f5f5f4"}
            roughness={0.6}
            metalness={0.05}
          />
        </RoundedBox>
        {/* Status dot: the only color on the plate. */}
        <mesh position={[0, 0.1, 0.1]}>
          <sphereGeometry args={[0.1, 20, 20]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={node.status === "active" ? 0.85 : 0.2}
            roughness={0.4}
          />
        </mesh>
      </Pulse>
      {focused && (
        <mesh position={[0, 0, -0.02]}>
          <ringGeometry args={[0.78, 0.86, 48]} />
          <meshBasicMaterial
            color="#3f3f46"
            transparent
            opacity={0.65}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <Html
        position={[0, -0.66, 0]}
        center
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div
          className="whitespace-nowrap text-center text-[11px] font-medium leading-tight text-zinc-700 dark:text-zinc-300"
          style={{ textShadow: "0 1px 2px rgba(255,255,255,0.7)" }}
        >
          {node.tool}
          <div className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
            {node.status === "active"
              ? "running"
              : node.status === "success"
                ? "done"
                : "failed"}
          </div>
        </div>
      </Html>
    </group>
  );
}

function ClusterNode({
  position,
  count,
  selected,
  focused,
  onSelect,
}: {
  position: [number, number, number];
  count: number;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
}) {
  return (
    <group position={position}>
      <RoundedBox
        args={[1.2, 0.64, 0.16]}
        radius={0.08}
        smoothness={4}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <meshStandardMaterial
          color={selected ? "#ffffff" : "#e7e5e4"}
          roughness={0.7}
          metalness={0.02}
        />
      </RoundedBox>
      {focused && (
        <mesh position={[0, 0, -0.02]}>
          <ringGeometry args={[0.78, 0.86, 48]} />
          <meshBasicMaterial
            color="#3f3f46"
            transparent
            opacity={0.65}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <Html
        position={[0, -0.66, 0]}
        center
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div className="whitespace-nowrap text-center text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          +{count} earlier
        </div>
      </Html>
    </group>
  );
}

function Scene({
  nodes,
  collapsedCount,
  selectedId,
  focusId,
  onSelect,
}: Props & { focusId: string | null }) {
  const items: Array<{ id: string; x: number }> = useMemo(() => {
    const xs = layout(nodes.length + (collapsedCount > 0 ? 1 : 0));
    const list: Array<{ id: string; x: number }> = [];
    let k = 0;
    if (collapsedCount > 0) {
      list.push({ id: CLUSTER_ID, x: xs[k++] });
    }
    for (const n of nodes) {
      list.push({ id: n.id, x: xs[k++] });
    }
    return list;
  }, [nodes, collapsedCount]);

  const depKey = useMemo(
    () =>
      [
        nodes.map((n) => `${n.id}:${n.status}`).join(","),
        collapsedCount,
        selectedId,
        focusId,
      ].join("|"),
    [nodes, collapsedCount, selectedId, focusId],
  );

  return (
    <>
      <DemandInvalidator depKey={depKey} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[3, 5, 4]} intensity={1.15} />
      {/* Edges: consecutive real calls, in actual execution order. */}
      {items.slice(0, -1).map((item, i) => (
        <Line
          key={`edge-${item.id}`}
          points={[
            [item.x + 0.62, 0, 0],
            [items[i + 1].x - 0.62, 0, 0],
          ]}
          color="#d6d3d1"
          lineWidth={1.5}
          transparent
          opacity={0.85}
        />
      ))}
      {collapsedCount > 0 && (
        <ClusterNode
          position={[items[0].x, 0, 0]}
          count={collapsedCount}
          selected={selectedId === CLUSTER_ID}
          focused={focusId === CLUSTER_ID}
          onSelect={() => onSelect(CLUSTER_ID)}
        />
      )}
      {nodes.map((node) => {
        const x = items.find((it) => it.id === node.id)?.x ?? 0;
        return (
          <ToolNode
            key={node.id}
            node={node}
            position={[x, 0, 0]}
            selected={selectedId === node.id}
            focused={focusId === node.id}
            onSelect={onSelect}
          />
        );
      })}
    </>
  );
}

export default function ToolCanvas(props: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);

  const order = useMemo(() => {
    const ids = props.nodes.map((n) => n.id);
    return props.collapsedCount > 0 ? [CLUSTER_ID, ...ids] : ids;
  }, [props.nodes, props.collapsedCount]);

  const focusLabel = useMemo(() => {
    if (!focusId) return null;
    if (focusId === CLUSTER_ID) return `+${props.collapsedCount} earlier calls`;
    return props.nodes.find((n) => n.id === focusId)?.tool ?? null;
  }, [focusId, props.nodes, props.collapsedCount]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (order.length === 0) return;
      const idx = focusId ? order.indexOf(focusId) : -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusId(order[(idx + 1 + order.length) % order.length]);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusId(order[(idx - 1 + order.length) % order.length]);
      } else if (e.key === "Enter" || e.key === " ") {
        if (focusId) {
          e.preventDefault();
          props.onSelect(focusId);
        }
      } else if (e.key === "Escape") {
        props.onSelect(null);
        setFocusId(null);
      }
    },
    [order, focusId, props],
  );

  return (
    <div
      role="group"
      aria-label="3D view of agent tool calls. Use left and right arrow keys to move between tool calls, Enter to see details."
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="relative h-56 w-full overflow-hidden rounded-xl border border-zinc-200 bg-stone-50 outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        camera={{ position: [0, 1.5, 6.9], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
        aria-hidden="true"
      >
        <Scene {...props} focusId={focusId} />
      </Canvas>
      <div aria-live="polite" className="sr-only">
        {focusLabel ? `Focused: ${focusLabel}` : ""}
      </div>
    </div>
  );
}
