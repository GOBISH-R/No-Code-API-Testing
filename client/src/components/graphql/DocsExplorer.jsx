import { useMemo, useState } from 'react';
import { findType, rootTypes, fieldsOf, typeRefName, namedTypeOf } from '../../utils/graphqlSchema.js';
import { buildSearchIndex, searchIndex, kindLabel } from '../../utils/graphqlDocs.js';
import TabBar from '../common/TabBar.jsx';
import './graphql-tools.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

// A type name rendered as a link, so following a field's return type is one click.
function TypeLink({ typeRef, name, onNavigate }) {
  const label = typeRef ? typeRefName(typeRef) : name;
  const target = typeRef ? namedTypeOf(typeRef) : name;

  if (!target) return <code className="docs-type-ref">{label}</code>;

  return (
    <button className="docs-type-ref docs-type-ref--link" onClick={() => onNavigate(target)}>
      {label}
    </button>
  );
}

function ArgumentList({ args, onNavigate }) {
  if (!args?.length) return null;

  return (
    <div className="docs-args">
      <span className="docs-args__title">Arguments</span>
      {args.map((arg) => (
        <div className="docs-arg" key={arg.name}>
          <code className="docs-arg__name">{arg.name}</code>
          <TypeLink typeRef={arg.type} onNavigate={onNavigate} />
          {arg.defaultValue !== null && arg.defaultValue !== undefined && (
            <span className="docs-arg__default">= {arg.defaultValue}</span>
          )}
          {arg.description && <p className="docs-arg__description">{arg.description}</p>}
        </div>
      ))}
    </div>
  );
}

function FieldEntry({ field, onNavigate }) {
  return (
    <div className="docs-field">
      <div className="docs-field__head">
        <code className="docs-field__name">{field.name}</code>
        <TypeLink typeRef={field.type} onNavigate={onNavigate} />
      </div>
      {field.description && <p className="docs-field__description">{field.description}</p>}
      <ArgumentList args={field.args} onNavigate={onNavigate} />
    </div>
  );
}

function TypeDoc({ type, onNavigate }) {
  if (!type) {
    return <p className="docs-empty">That type is not present in this schema.</p>;
  }

  const fields = fieldsOf(type);
  const inputFields = type.inputFields || [];
  const enumValues = type.enumValues || [];
  const isLeaf = !fields.length && !inputFields.length && !enumValues.length;

  return (
    <div className="docs-type">
      <div className="docs-type__head">
        <code className="docs-type__name">{type.name}</code>
        <span className="docs-type__kind">{type.kind.toLowerCase().replace('_', ' ')}</span>
      </div>
      {type.description && <p className="docs-type__description">{type.description}</p>}

      {fields.map((field) => (
        <FieldEntry key={field.name} field={field} onNavigate={onNavigate} />
      ))}

      {inputFields.map((field) => (
        <div className="docs-field" key={field.name}>
          <div className="docs-field__head">
            <code className="docs-field__name">{field.name}</code>
            <TypeLink typeRef={field.type} onNavigate={onNavigate} />
          </div>
          {field.description && <p className="docs-field__description">{field.description}</p>}
        </div>
      ))}

      {enumValues.length > 0 && (
        <div className="docs-enum">
          {enumValues.map((value) => (
            <div className="docs-enum__value" key={value.name}>
              <code>{value.name}</code>
              {value.description && <p className="docs-field__description">{value.description}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Scalars and unions legitimately have none of the above. */}
      {isLeaf && <p className="docs-empty">This type has no fields of its own.</p>}
    </div>
  );
}

export default function DocsExplorer({ schema, endpoint, onClose, tabs, activeTab, onTabChange }) {
  useEscapeToClose(onClose);
  const roots = rootTypes(schema);
  const [query, setQuery] = useState('');
  // A simple navigation stack, so "Back" returns the way the user came.
  const [stack, setStack] = useState(() => [roots.query?.name || null].filter(Boolean));

  const index = useMemo(() => buildSearchIndex(schema), [schema]);
  const results = useMemo(() => searchIndex(index, query), [index, query]);

  const currentName = stack[stack.length - 1];
  const currentType = findType(schema, currentName);

  const navigate = (typeName) => {
    if (!typeName) return;
    setQuery('');
    setStack((s) => (s[s.length - 1] === typeName ? s : [...s, typeName]));
  };

  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Schema</h3>
        <p className="schema-viewer__endpoint">
          <code>{endpoint}</code>
        </p>
        {onTabChange && <TabBar tabs={tabs} activeTab={activeTab} onChange={onTabChange} />}

        <input
          className="docs-search"
          type="search"
          placeholder="Search types, fields, arguments, enum values…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="docs-body">
          {query.trim() ? (
            <>
              <p className="docs-results__count">
                {results.length === 0
                  ? `Nothing matches “${query.trim()}”.`
                  : `${results.length} result${results.length === 1 ? '' : 's'}`}
              </p>
              {results.map((result) => (
                <button
                  key={result.id}
                  className="docs-result"
                  onClick={() => navigate(result.typeName)}
                  title={result.typeName ? `Go to ${result.typeName}` : undefined}
                >
                  <span className="docs-result__kind">{kindLabel(result.kind)}</span>
                  <code className="docs-result__signature">{result.signature}</code>
                  {result.parent && <span className="docs-result__parent">on {result.parent}</span>}
                  {result.description && <p className="docs-result__description">{result.description}</p>}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="docs-nav">
                <button className="docs-nav__back" onClick={back} disabled={stack.length <= 1}>
                  ← Back
                </button>
                <span className="docs-nav__trail">{stack.join(' › ')}</span>
              </div>

              {/* Entry points, so the explorer opens somewhere useful. */}
              <div className="docs-roots">
                {roots.query && (
                  <button className="docs-root" onClick={() => navigate(roots.query.name)}>
                    Queries
                  </button>
                )}
                {roots.mutation && (
                  <button className="docs-root" onClick={() => navigate(roots.mutation.name)}>
                    Mutations
                  </button>
                )}
                {roots.subscription && (
                  <button className="docs-root" onClick={() => navigate(roots.subscription.name)}>
                    Subscriptions
                  </button>
                )}
              </div>

              <TypeDoc type={currentType} onNavigate={navigate} />
            </>
          )}
        </div>

        <div className="modal__actions">
          <button className="modal__confirm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
