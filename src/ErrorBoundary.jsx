import React from 'react';

/**
 * React error boundary that catches unhandled render/lifecycle errors.
 * Renders a recoverable fallback UI so the entire app does not go blank.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>Something went sideways in the Bust Bay.</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button
            className="mf-button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            RELOAD BAY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
