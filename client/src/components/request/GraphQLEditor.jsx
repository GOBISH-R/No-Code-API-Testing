import { useState } from 'react';
import SchemaExplorer from '../graphql/SchemaExplorer.jsx';
import QueryEditor from '../graphql/QueryEditor.jsx';
import { skipReasonLabel } from '../../utils/graphqlValidation.js';

const QUERY_PLACEHOLDER = 'query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}';

function ValidationReport({ validation }) {
  if (!validation) return null;

  if (validation.skipped) {
    const label = skipReasonLabel(validation.reason);
    return label ? <p className="graphql-validation graphql-validation--muted">{label}</p> : null;
  }

  if (validation.errors.length === 0) {
    return <p className="graphql-validation graphql-validation--ok">Query matches the schema.</p>;
  }

  return (
    <div className="graphql-validation graphql-validation--error">
      {validation.errors.map((error, index) => (
        <p key={index} className="graphql-validation__item">
          {error.line ? <span className="graphql-validation__loc">Line {error.line}:</span> : null}{' '}
          {error.message}
        </p>
      ))}
    </div>
  );
}

function isValidJson(text) {
  if (!text.trim()) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function SchemaStatus({ schemaState }) {
  const { status, summary, error } = schemaState;

  if (status === 'loading') {
    return <span className="graphql-schema__status">Loading schema…</span>;
  }

  if (status === 'error') {
    return <span className="graphql-schema__status graphql-schema__status--error">{error}</span>;
  }

  if (status === 'ready' && summary && schemaState.validation?.reason === 'endpoint-changed') {
    return (
      <span className="graphql-schema__status">
        Schema loaded for a different endpoint — load it again for this URL.
      </span>
    );
  }

  if (status === 'ready' && summary) {
    const roots = [
      summary.queryType && 'queries',
      summary.mutationType && 'mutations',
      summary.subscriptionType && 'subscriptions',
    ].filter(Boolean);

    return (
      <span className="graphql-schema__status graphql-schema__status--ok">
        Schema loaded — {summary.typeCount} types
        {roots.length > 0 ? ` (${roots.join(', ')})` : ''}
      </span>
    );
  }

  return <span className="graphql-schema__status">No schema loaded.</span>;
}

export default function GraphQLEditor({ graphql, schemaState }) {
  const variablesAreValid = isValidJson(graphql.value.variables);
  const [showSchema, setShowSchema] = useState(false);

  const schemaLoaded = schemaState?.status === 'ready' && schemaState.schema;

  return (
    <div className="graphql-editor">
      {schemaState && (
        <div className="graphql-schema">
          <button
            type="button"
            className="graphql-schema__load"
            onClick={schemaState.load}
            disabled={schemaState.status === 'loading'}
            title="Run an introspection query against this endpoint"
          >
            {schemaState.status === 'loading' ? 'Loading…' : 'Load Schema'}
          </button>

          {schemaLoaded && (
            <button
              type="button"
              className="graphql-schema__view"
              onClick={() => setShowSchema(true)}
              title="Browse or search the loaded schema"
            >
              Schema
            </button>
          )}

          <SchemaStatus schemaState={schemaState} />
        </div>
      )}

      {showSchema && schemaLoaded && (
        <SchemaExplorer
          schema={schemaState.schema}
          endpoint={schemaState.endpoint}
          onClose={() => setShowSchema(false)}
        />
      )}

      <div className="graphql-editor__field">
        <span className="graphql-editor__label">
          Query
          {schemaLoaded && (
            <span className="auth-editor__optional">(Ctrl-Space for schema-aware suggestions)</span>
          )}
        </span>
        <QueryEditor
          value={graphql.value.query}
          onChange={(query) => graphql.set({ query })}
          schema={schemaState?.builtSchema}
          placeholder={QUERY_PLACEHOLDER}
        />
        <ValidationReport validation={schemaState?.validation} />
      </div>

      <label className="graphql-editor__field">
        Variables <span className="auth-editor__optional">(JSON, optional)</span>
        <textarea
          className={`body-editor__textarea ${variablesAreValid ? '' : 'body-editor__textarea--invalid'}`}
          placeholder={'{\n  "id": "1"\n}'}
          value={graphql.value.variables}
          onChange={(e) => graphql.set({ variables: e.target.value })}
          spellCheck={false}
          rows={5}
        />
        {!variablesAreValid && <p className="body-editor__error">Invalid JSON</p>}
      </label>

      <label className="graphql-editor__field graphql-editor__field--inline">
        Operation name <span className="auth-editor__optional">(optional)</span>
        <input
          type="text"
          placeholder="GetUser"
          value={graphql.value.operationName}
          onChange={(e) => graphql.set({ operationName: e.target.value })}
        />
      </label>
    </div>
  );
}
