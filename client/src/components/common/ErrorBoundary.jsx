import { Component } from 'react';
import './error-boundary.css';

// Must be a class: React only reports render/lifecycle errors through
// getDerivedStateFromError/componentDidCatch, and there is no hook equivalent.
// Without this, a single thrown render error unmounts the entire tree and leaves a
// blank page with no way back except a manual refresh.
export default class ErrorBoundary extends Component {
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

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary__panel">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__lead">
            The interface hit an unexpected error. Your saved collections, environments and
            requests are stored on the server and are unaffected.
          </p>

          <pre className="error-boundary__message">{error.message || String(error)}</pre>

          <div className="error-boundary__actions">
            <button
              type="button"
              className="error-boundary__button error-boundary__button--primary"
              onClick={this.handleRetry}
            >
              Try again
            </button>
            <button type="button" className="error-boundary__button" onClick={this.handleReload}>
              Reload the app
            </button>
          </div>

          <p className="error-boundary__hint">
            “Try again” re-renders the screen — if the error repeats, reload.
          </p>
        </div>
      </div>
    );
  }
}
