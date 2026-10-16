import MethodSelector from './MethodSelector.jsx';
import ProtocolSelector from './ProtocolSelector.jsx';
import Icon from '../common/Icon.jsx';
import { isCurlCommand } from '../../utils/curlParse.js';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export default function UrlBar({
  protocol,
  onProtocolChange,
  method,
  onMethodChange,
  url,
  onUrlChange,
  onSend,
  urlError,
  isSending,
  onSave,
  isSaving,
  saveLabel,
  onImportCurl,
  onShowCode,
  readOnly = false,
}) {
  const isGraphQL = protocol === 'graphql';

  return (
    <div className="url-bar">
      <div className="url-bar__row">
        <ProtocolSelector protocol={protocol} onChange={onProtocolChange} />
        {isGraphQL ? (
          <span className="method-select method-select--post url-bar__fixed-method" title="GraphQL is always sent as POST">
            POST
          </span>
        ) : (
          <MethodSelector method={method} onChange={onMethodChange} />
        )}
        <input
          type="text"
          className="url-bar__input"
          placeholder="Enter a URL or paste a cURL command"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          // A pasted cURL command fills in the whole request, the way Postman does,
          // instead of landing in the address bar as one long line.
          onPaste={(e) => {
            const text = e.clipboardData?.getData('text') ?? '';
            if (isCurlCommand(text)) {
              e.preventDefault();
              onImportCurl(text);
            }
          }}
          // Enter in the address bar sends, as it does in Postman and in a browser.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !isSending) onSend();
          }}
          aria-label="Request URL"
        />
        <button
          className="url-bar__code"
          onClick={onShowCode}
          title="Code snippet"
          aria-label="Code snippet"
        >
          <Icon name="code" />
        </button>
        <button
          className="url-bar__save"
          onClick={onSave}
          disabled={isSaving || readOnly}
          title={readOnly ? 'Viewers cannot save to this workspace' : `${saveLabel} (${MOD}+S)`}
        >
          {isSaving ? 'Saving…' : saveLabel}
        </button>
        <button className="url-bar__send" onClick={onSend} disabled={isSending} title={`Send (${MOD}+Enter)`}>
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {urlError && <p className="url-bar__error">{urlError}</p>}
    </div>
  );
}
