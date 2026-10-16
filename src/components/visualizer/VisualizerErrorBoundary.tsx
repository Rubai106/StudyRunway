/**
 * Error boundary around the WebGL canvas.
 *
 * If three.js fails for any reason (missing WebGL, driver crash, shader
 * error), the visualizer degrades to the accessible list instead of
 * breaking the chat. The boundary also notifies the parent so it can
 * remember the failure and stay in list mode.
 */

"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onError: () => void;
}

interface State {
  hasError: boolean;
}

export class VisualizerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
