import { Component, type ErrorInfo, type ReactNode } from 'react';
import EmptyState from './EmptyState';
import { t } from '../i18n';

/** Last line of defence: a crash in a screen shows a message and a Reload button instead of a blank page. Stored data is never touched. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EmptyState
        title={t('crash.title')}
        body={t('crash.body')}
        action={
          <button type="button" onClick={() => window.location.reload()} style={{ color: 'var(--accent-hi)', padding: 10 }}>
            {t('crash.reload')}
          </button>
        }
      />
    );
  }
}
