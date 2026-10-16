import { useState } from 'react';
import Icon from '../common/Icon.jsx';
import {
  rootTypes,
  groupTypes,
  fieldsOf,
  formatFieldSignature,
  typeRefName,
  schemaStats,
} from '../../utils/graphqlSchema.js';
import TabBar from '../common/TabBar.jsx';
import './graphql-tools.css';
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js';

function FieldRow({ field }) {
  return (
    <div className="schema-field">
      <code className="schema-field__signature">{formatFieldSignature(field)}</code>
      {field.description && <p className="schema-field__description">{field.description}</p>}
    </div>
  );
}

function Section({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!count) return null;

  return (
    <section className="schema-section">
      <button className="schema-section__header" onClick={() => setOpen((o) => !o)}>
        <span className="schema-section__caret">
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
        </span>
        <span className="schema-section__title">{title}</span>
        <span className="schema-section__count">{count}</span>
      </button>
      {open && <div className="schema-section__body">{children}</div>}
    </section>
  );
}

// One named type. Enums list their values, input objects their input fields, object
// and interface types their fields — a scalar or union legitimately has none of
// those, so it renders as just its name.
function TypeCard({ type }) {
  const fields = fieldsOf(type);
  const inputFields = type.inputFields || [];
  const enumValues = type.enumValues || [];

  return (
    <div className="schema-type">
      <div className="schema-type__header">
        <code className="schema-type__name">{type.name}</code>
        <span className="schema-type__kind">{type.kind.toLowerCase().replace('_', ' ')}</span>
      </div>

      {type.description && <p className="schema-type__description">{type.description}</p>}

      {fields.map((field) => (
        <FieldRow key={field.name} field={field} />
      ))}

      {inputFields.map((field) => (
        <div className="schema-field" key={field.name}>
          <code className="schema-field__signature">
            {field.name}: {typeRefName(field.type)}
          </code>
          {field.description && <p className="schema-field__description">{field.description}</p>}
        </div>
      ))}

      {enumValues.length > 0 && (
        <div className="schema-enum-values">
          {enumValues.map((value) => (
            <code key={value.name} className="schema-enum-value" title={value.description || undefined}>
              {value.name}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

function OperationSection({ title, type, defaultOpen }) {
  const fields = fieldsOf(type);
  return (
    <Section title={title} count={fields.length} defaultOpen={defaultOpen}>
      {fields.map((field) => (
        <FieldRow key={field.name} field={field} />
      ))}
    </Section>
  );
}

function TypeSection({ title, types }) {
  return (
    <Section title={title} count={types.length}>
      {types.map((type) => (
        <TypeCard key={type.name} type={type} />
      ))}
    </Section>
  );
}

export default function SchemaViewer({ schema, endpoint, onClose, tabs, activeTab, onTabChange }) {
  useEscapeToClose(onClose);
  const roots = rootTypes(schema);
  const groups = groupTypes(schema);
  const stats = schemaStats(schema);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Schema</h3>
        <p className="schema-viewer__endpoint">
          <code>{endpoint}</code>
        </p>
        {onTabChange && <TabBar tabs={tabs} activeTab={activeTab} onChange={onTabChange} />}
        <p className="schema-viewer__stats">
          {stats.queries} queries · {stats.mutations} mutations · {stats.subscriptions} subscriptions ·{' '}
          {stats.types} types
        </p>

        <div className="schema-viewer__body">
          {/* Operations first — they are the entry points a tester actually calls. */}
          <OperationSection title="Queries" type={roots.query} defaultOpen />
          <OperationSection title="Mutations" type={roots.mutation} />
          <OperationSection title="Subscriptions" type={roots.subscription} />

          <TypeSection title="Objects" types={groups.objects} />
          <TypeSection title="Interfaces" types={groups.interfaces} />
          <TypeSection title="Unions" types={groups.unions} />
          <TypeSection title="Enums" types={groups.enums} />
          <TypeSection title="Input objects" types={groups.inputs} />
          <TypeSection title="Scalars" types={groups.scalars} />
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
