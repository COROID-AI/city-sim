import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * ErrorBoundary: catches render/lifecycle errors in the R3F tree. On failure
 * it shows a DOM fallback with a retry that reloads the app cleanly. Also
 * catches WebGL context-loss events on the canvas so a GPU hiccup doesn't
 * black-screen the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  componentDidMount() {
    const el = document.querySelector('canvas');
    if (el) {
      const onLost = () => this.setState({ hasError: true, message: 'WebGL context lost' });
      const onRestored = () => this.setState({ hasError: false, message: '' });
      el.addEventListener('webglcontextlost', onLost);
      el.addEventListener('webglcontextrestored', onRestored);
      this.cleanup = () => {
        el.removeEventListener('webglcontextlost', onLost);
        el.removeEventListener('webglcontextrestored', onRestored);
      };
    }
  }

  cleanup: (() => void) | null = null;

  componentWillUnmount() {
    this.cleanup?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <div className="error-icon">⚠</div>
          <h1>Something went wrong</h1>
          <p>{this.state.message}</p>
          <button onClick={this.handleRetry}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}