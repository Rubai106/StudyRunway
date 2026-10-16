/**
 * Module-level store for the tool visualizer.
 *
 * The store subscribes once to the agent event bus and reduces every real
 * event into node state. Because the state lives outside React, the
 * visualizer keeps showing the real history even if the component is
 * unmounted and remounted (e.g. layout changes in the chat workstream).
 *
 * `resetVisualizerStore` is only for test/demo harnesses — it clears the
 * store without fabricating events. The agent itself never calls it.
 */

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { subscribeAgentEvent } from "@/lib/events";
import {
  initialVisualizerState,
  reduceVisualizerState,
  type VisualizerState,
} from "./nodeState";

let state: VisualizerState = initialVisualizerState();
const reactListeners = new Set<() => void>();
let busSubscribed = false;

function emit(): void {
  for (const fn of reactListeners) {
    fn();
  }
}

function ensureBusSubscription(): void {
  if (busSubscribed) {
    return;
  }
  busSubscribed = true;
  subscribeAgentEvent((event) => {
    const next = reduceVisualizerState(state, event, Date.now());
    if (next !== state) {
      state = next;
      emit();
    }
  });
}

function subscribeReact(fn: () => void): () => void {
  reactListeners.add(fn);
  return () => {
    reactListeners.delete(fn);
  };
}

function getSnapshot(): VisualizerState {
  return state;
}

/** React binding for the visualizer state. */
export function useVisualizerState(): VisualizerState {
  useEffect(() => {
    ensureBusSubscription();
  }, []);
  return useSyncExternalStore(subscribeReact, getSnapshot, getSnapshot);
}

/** Clear the store. For demo/test harnesses only — not an agent event. */
export function resetVisualizerStore(): void {
  state = initialVisualizerState();
  emit();
}
