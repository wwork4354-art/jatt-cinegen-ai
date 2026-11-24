import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Studio UI boundary caught error:', error, info);
  }

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#07090E] text-slate-100 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#0D1118] p-6 space-y-4 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-semibold text-white">
                Workspace Recovery
              </h1>
              <p className="text-xs leading-relaxed text-slate-400">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Restore Studio</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
