import ResponseMeta from './ResponseMeta.jsx';
import ResponseTabs from './ResponseTabs.jsx';
import AssertionResults from '../assertions/AssertionResults.jsx';
import CaptureResults from '../captures/CaptureResults.jsx';
import './response-panel.css';

export default function ResponsePanel({ notice, isSending, result }) {
  return (
    <section className="response-panel">
      <h2 className="response-panel__title">Response</h2>

      {notice && (
        <div className={`response-panel__notice response-panel__notice--${notice.type}`}>
          {notice.message}
        </div>
      )}

      {isSending && <div className="response-panel__loading">Sending request…</div>}

      {!isSending && result?.success && (
        <div className="response-result">
          <ResponseMeta
            status={result.response.status}
            statusText={result.response.statusText}
            time={result.meta.time}
            size={result.response.size}
            headersSize={result.response.headersSize}
            phases={result.meta.phases}
            redirects={result.meta.redirects}
            headers={result.response.headers}
          />
          <AssertionResults assertions={result.assertions} />
          <CaptureResults captures={result.captures} />
          <ResponseTabs
            body={result.response.body}
            headers={result.response.headers}
            status={result.response.status}
          />
        </div>
      )}

      {!isSending && result && !result.success && (
        <div className="response-result">
          <div className="response-meta">
            <span className="response-meta__status status-error">Failed</span>
            <span>{result.meta.time} ms</span>
          </div>
          <p className="response-result__error">
            {result.error.message}
            {result.error.code && <span className="response-result__error-code"> ({result.error.code})</span>}
          </p>
        </div>
      )}

      {!isSending && !result && !notice && (
        <div className="response-panel__empty">
          <p>Send a request to see its response here.</p>
        </div>
      )}
    </section>
  );
}
