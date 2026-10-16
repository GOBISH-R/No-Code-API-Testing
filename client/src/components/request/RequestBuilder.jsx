import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRequestBuilder, withoutFileData } from '../../hooks/useRequestBuilder.js';
import { useAssertions } from '../../hooks/useAssertions.js';
import { useCaptures } from '../../hooks/useCaptures.js';
import { useGraphQLSchema } from '../../hooks/useGraphQLSchema.js';
import { useSplitPane } from '../../hooks/useSplitPane.js';
import { useShortcuts } from '../../hooks/useShortcuts.js';
import {
  buildSchemaFromIntrospection,
  validateGraphQLQuery,
} from '../../utils/graphqlValidation.js';
import { executeRequest } from '../../services/requestService.js';
import { createSavedRequest, updateSavedRequest } from '../../services/savedRequestService.js';
import { createCollection } from '../../services/collectionService.js';
import { isCurlCommand, parseCurl } from '../../utils/curlParse.js';
import UrlBar from './UrlBar.jsx';
import ProtocolSelector from './ProtocolSelector.jsx';
import RequestTabs from './RequestTabs.jsx';
import WebSocketWorkspace from '../websocket/WebSocketWorkspace.jsx';
import ResponsePanel from '../response/ResponsePanel.jsx';
import SaveRequestModal from '../collections/SaveRequestModal.jsx';
import CodeSnippetModal from './CodeSnippetModal.jsx';
import './request-builder.css';

export default function RequestBuilder({
  savedRequest,
  onSaved,
  collections,
  environmentId,
  runtimeVariables,
  onCaptured,
  draft,
  onSent,
  readOnly = false,
}) {
  const {
    request,
    setMethod,
    setUrl,
    setProtocol,
    params,
    headers,
    body,
    graphql,
    websocket,
    auth,
    loadRequest,
    reset,
  } = useRequestBuilder();
  const isWebSocket = request.protocol === 'websocket';
  const assertions = useAssertions();
  const captures = useCaptures();
  const graphqlSchema = useGraphQLSchema();

  // Built once per loaded schema rather than per keystroke — buildClientSchema is far
  // too expensive to run on every edit.
  const builtSchema = useMemo(
    () => buildSchemaFromIntrospection(graphqlSchema.schema),
    [graphqlSchema.schema],
  );

  const graphqlValidation = useMemo(
    () =>
      request.protocol === 'graphql'
        ? validateGraphQLQuery({
            schema: builtSchema,
            query: request.graphql.query,
            operationName: request.graphql.operationName,
            url: request.url,
            schemaUrl: graphqlSchema.loadedForUrl,
            environmentId,
            schemaEnvironmentId: graphqlSchema.loadedForEnvironmentId,
          })
        : { skipped: true, reason: 'not-graphql', errors: [] },
    [
      request.protocol,
      request.graphql.query,
      request.graphql.operationName,
      request.url,
      environmentId,
      graphqlSchema.loadedForUrl,
      graphqlSchema.loadedForEnvironmentId,
      builtSchema,
    ],
  );

  // The editor only needs to call load() — the endpoint, headers, auth and variables
  // it introspects with are whatever the builder currently holds, so they're bound
  // here rather than threaded through the component tree.
  const graphqlSchemaTools = {
    ...graphqlSchema,
    validation: graphqlValidation,
    // The executable schema object, shared with the editor so completion and
    // validation are driven by exactly the same schema.
    builtSchema,
    load: () =>
      graphqlSchema.load({
        url: request.url,
        headers: request.headers,
        auth: request.auth,
        environmentId,
        runtimeVariables,
      }),
  };
  const [urlError, setUrlError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [saveNoticeIsError, setSaveNoticeIsError] = useState(false);

  // Set just before handing our own save to onSaved. That save comes back as a "new"
  // selected request, and reloading it would wipe the response on screen and the
  // "Saved." notice — the builder already holds exactly what was saved.
  const justSavedId = useRef(null);

  // Loads the selected saved request into the builder, or resets to a blank one.
  // Keyed on the id, not the object: re-saving the open request produces a fresh object
  // for the same request, which is not a reason to reload it.
  // A history entry (draft) loads the same way, but as a new request with no saved id.
  const savedRequestId = savedRequest?._id ?? null;
  const draftKey = draft?.key ?? null;
  useEffect(() => {
    if (savedRequestId && justSavedId.current === savedRequestId) {
      justSavedId.current = null;
      return;
    }
    const source = savedRequest || draft?.config;
    if (source) {
      loadRequest(source);
      assertions.loadRows(source.assertions);
      captures.loadRows(source.captures);
    } else {
      reset();
      assertions.reset();
      captures.reset();
    }
    setResult(null);
    setNotice(
      !savedRequest && draft?.config?.bodyOmitted
        ? { type: 'warning', message: 'This request’s body was too large to keep in history, so it was left out.' }
        : null,
    );
    setUrlError(null);
    setSaveNotice(null);
    // A schema belongs to the endpoint it was introspected from, so it must not carry
    // over to a request that may point somewhere else.
    graphqlSchema.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRequestId, draftKey]);

  // Replaces the request with a pasted cURL command. Assertions and captures belong to
  // the test, not to the call, so they are kept.
  const importCurl = (text) => {
    try {
      const { config, warnings } = parseCurl(text);
      loadRequest(config);
      graphqlSchema.clear();
      setResult(null);
      setUrlError(null);
      setNotice(
        warnings.length > 0
          ? { type: 'warning', message: `Imported from cURL. ${warnings.join(' ')}` }
          : { type: 'info', message: 'Imported from cURL. Check the Params, Headers, Body and Auth tabs, then Send.' },
      );
    } catch (err) {
      setUrlError(err.message || 'That cURL command could not be read.');
    }
  };

  const handleSend = async () => {
    // A cURL command typed (rather than pasted) into the address bar imports on Send.
    if (isCurlCommand(request.url)) {
      importCurl(request.url);
      return;
    }
    if (!request.url.trim()) {
      setUrlError('Enter a URL before sending.');
      setNotice(null);
      return;
    }

    // Only ever blocks when validation actually ran against a loaded schema — with
    // no schema, validation is skipped and GraphQL behaves exactly as it did before.
    if (!graphqlValidation.skipped && graphqlValidation.errors.length > 0) {
      setUrlError(null);
      setNotice({
        type: 'error',
        message: `The query does not match the loaded schema — not sent. ${graphqlValidation.errors[0].message}`,
      });
      return;
    }

    setUrlError(null);
    setNotice(null);
    setIsSending(true);
    setResult(null);

    try {
      const executionResult = await executeRequest({
        ...request,
        assertions: assertions.rows,
        captures: captures.rows,
        environmentId,
        runtimeVariables,
      });
      setResult(executionResult);
      if (executionResult.captures) onCaptured(executionResult.captures);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to execute request.';
      setNotice({ type: 'error', message });
    } finally {
      setIsSending(false);
      // The server records every send it accepted, refused ones included.
      onSent?.();
    }
  };

  const handleSaveClick = () => {
    if (isSaving) return;
    if (savedRequest?._id) {
      updateExisting();
    } else {
      setShowSaveModal(true);
    }
  };

  const flashSaveNotice = (message, isError = false) => {
    setSaveNotice(message);
    setSaveNoticeIsError(isError);
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const updateExisting = async () => {
    setIsSaving(true);
    try {
      const updated = await updateSavedRequest(savedRequest._id, {
        name: savedRequest.name,
        collectionId: savedRequest.collectionId,
        // Carried through explicitly: omitting it would move the request back to the
        // collection root every time it was re-saved from inside a folder.
        folderId: savedRequest.folderId ?? null,
        // File contents are sent with a request, never saved with it.
        ...withoutFileData(request),
        assertions: assertions.rows,
        captures: captures.rows,
      });
      // Same id as before, so the load effect does not re-run — nothing to flag.
      onSaved(updated);
      flashSaveNotice('Saved.');
    } catch (err) {
      flashSaveNotice(err.response?.data?.message || err.message || 'Failed to save.', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Throws on failure so SaveRequestModal can show the error inline and stay open.
  const handleModalConfirm = async ({ name, collectionId, newCollectionName, folderId }) => {
    let targetCollectionId = collectionId;
    if (!targetCollectionId && newCollectionName) {
      const created = await createCollection({ name: newCollectionName });
      targetCollectionId = created._id;
    }

    const saved = await createSavedRequest({
      name,
      collectionId: targetCollectionId,
      folderId: folderId || null,
      ...withoutFileData(request),
      assertions: assertions.rows,
      captures: captures.rows,
    });
    justSavedId.current = saved._id;
    onSaved(saved);
    setShowSaveModal(false);
    flashSaveNotice('Saved.');
  };

  const closeCode = useCallback(() => setShowCode(false), []);

  const split = useSplitPane('vats.workbench.split', 45);

  useShortcuts({
    // WebSocket has no single "send": its workspace owns connect and message sending.
    onSend: isWebSocket || isSending || showCode ? null : handleSend,
    onSave: showSaveModal || showCode || readOnly ? null : handleSaveClick,
  });

  return (
    <div className="request-builder">
      {savedRequest && (
        <p className="request-builder__editing">
          Editing <strong>{savedRequest.name}</strong>
          {saveNotice && (
            <span
              className={`request-builder__save-notice ${saveNoticeIsError ? 'request-builder__save-notice--error' : ''}`}
            >
              {' '}
              — {saveNotice}
            </span>
          )}
        </p>
      )}
      {!savedRequest && saveNotice && (
        <p
          className={`request-builder__save-notice ${saveNoticeIsError ? 'request-builder__save-notice--error' : ''}`}
        >
          {saveNotice}
        </p>
      )}

      {/* WebSocket is a persistent connection, not a request that returns a response,
          so it gets its own workspace rather than this request/response layout. Only
          the protocol selector is shared. */}
      {isWebSocket && (
        <div className="request-builder__protocol-row">
          <ProtocolSelector protocol={request.protocol} onChange={setProtocol} />
          <span className="request-builder__protocol-note">
            A live connection — configure it, connect, then exchange messages below.
          </span>
        </div>
      )}

      {isWebSocket && (
        <WebSocketWorkspace
          requestId={savedRequest?._id ?? null}
          request={request}
          setUrl={setUrl}
          params={params}
          headers={headers}
          auth={auth}
          websocket={websocket}
          environmentId={environmentId}
          runtimeVariables={runtimeVariables}
          onSave={handleSaveClick}
          saveLabel={savedRequest ? 'Save' : 'Save As…'}
          isSaving={isSaving}
        />
      )}

      {!isWebSocket && (
      <>
      <UrlBar
        protocol={request.protocol}
        onProtocolChange={setProtocol}
        method={request.method}
        onMethodChange={setMethod}
        url={request.url}
        onUrlChange={(value) => {
          setUrl(value);
          if (urlError) setUrlError(null);
        }}
        onSend={handleSend}
        urlError={urlError}
        isSending={isSending}
        onSave={handleSaveClick}
        isSaving={isSaving}
        saveLabel={savedRequest ? 'Save' : 'Save As…'}
        onImportCurl={importCurl}
        onShowCode={() => setShowCode(true)}
        readOnly={readOnly}
      />

      <div
        className={`workbench ${split.dragging ? 'workbench--dragging' : ''}`}
        ref={split.containerRef}
      >
        <div className="workbench__request" style={{ flexGrow: split.ratio }}>
          <RequestTabs
            protocol={request.protocol}
            params={params}
            headers={headers}
            body={body}
            graphql={graphql}
            graphqlSchema={graphqlSchemaTools}
            auth={auth}
            assertions={assertions}
            captures={captures}
          />
        </div>

        <div
          className={`workbench__splitter ${split.dragging ? 'workbench__splitter--dragging' : ''}`}
          title="Drag to resize · double-click to reset"
          {...split.splitterProps}
        />

        <div className="workbench__response" style={{ flexGrow: 100 - split.ratio }}>
          <ResponsePanel notice={notice} isSending={isSending} result={result} />
        </div>
      </div>
      </>
      )}

      {showCode && <CodeSnippetModal request={request} onClose={closeCode} />}

      {showSaveModal && (
        <SaveRequestModal
          collections={collections}
          onConfirm={handleModalConfirm}
          onCancel={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}
