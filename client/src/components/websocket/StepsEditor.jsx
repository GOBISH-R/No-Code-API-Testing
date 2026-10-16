import { createId } from '../../utils/id.js';
import Icon from '../common/Icon.jsx';
import './websocket.css';

const STRATEGIES = [
  { value: 'next', label: 'next message' },
  { value: 'contains', label: 'message containing' },
  { value: 'equals', label: 'message equal to' },
  { value: 'jsonPath', label: 'JSONPath' },
  { value: 'type', label: 'message type is' },
  { value: 'silence', label: 'no message arrives' },
];

const SOURCES = [
  { value: 'message', label: 'Message text' },
  { value: 'json', label: 'JSON Path' },
  { value: 'messageType', label: 'Message type' },
  { value: 'messageSize', label: 'Message size' },
  { value: 'messageCount', label: 'Message count' },
  { value: 'connection', label: 'Connection state' },
  { value: 'closeCode', label: 'Close code' },
  { value: 'closeReason', label: 'Close reason' },
];

// Mirrors the server's WS_OPERATORS_BY_SOURCE so the UI never offers a pairing the
// backend would reject.
const OPERATORS = {
  message: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'matches', 'isEmpty', 'isNotEmpty'],
  json: ['exists', 'notExists', 'equals', 'notEquals', 'contains', 'notContains', 'matches', 'greaterThan', 'lessThan'],
  messageType: ['equals', 'notEquals'],
  messageSize: ['equals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'],
  messageCount: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual'],
  connection: ['equals', 'notEquals'],
  closeCode: ['equals', 'notEquals', 'greaterThanOrEqual', 'lessThanOrEqual'],
  closeReason: ['equals', 'contains', 'matches', 'isEmpty', 'isNotEmpty'],
};

const NO_VALUE = new Set(['exists', 'notExists', 'isEmpty', 'isNotEmpty']);

/**
 * Defines what an automated WebSocket step does.
 *
 * These only run in the Collection Runner — manual testing is watching the live log,
 * where there is no natural moment to evaluate an assertion. A step is send → wait →
 * assert → capture, because one connection usually carries a whole conversation.
 */
export default function StepsEditor({ websocket }) {
  const steps = websocket.value.steps || [];

  const update = (next) => websocket.set({ steps: next });

  const addStep = () =>
    update([
      ...steps,
      {
        id: createId(),
        name: '',
        send: '',
        waitFor: { strategy: 'next', value: '', path: '', timeoutMs: 10000 },
        assertions: [],
        captures: [],
      },
    ]);

  const patchStep = (index, patch) =>
    update(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const removeStep = (index) => update(steps.filter((_, i) => i !== index));

  const patchWait = (index, patch) =>
    patchStep(index, { waitFor: { ...steps[index].waitFor, ...patch } });

  const addAssertion = (index) =>
    patchStep(index, {
      assertions: [
        ...(steps[index].assertions || []),
        { id: createId(), source: 'message', operator: 'contains', expected: '', path: '' },
      ],
    });

  const patchAssertion = (stepIndex, assertionIndex, patch) =>
    patchStep(stepIndex, {
      assertions: steps[stepIndex].assertions.map((a, i) =>
        i === assertionIndex ? { ...a, ...patch } : a,
      ),
    });

  const removeAssertion = (stepIndex, assertionIndex) =>
    patchStep(stepIndex, {
      assertions: steps[stepIndex].assertions.filter((_, i) => i !== assertionIndex),
    });

  const addCapture = (index) =>
    patchStep(index, {
      captures: [
        ...(steps[index].captures || []),
        { id: createId(), source: 'json', path: '', variableName: '' },
      ],
    });

  const patchCapture = (stepIndex, captureIndex, patch) =>
    patchStep(stepIndex, {
      captures: steps[stepIndex].captures.map((c, i) => (i === captureIndex ? { ...c, ...patch } : c)),
    });

  const removeCapture = (stepIndex, captureIndex) =>
    patchStep(stepIndex, {
      captures: steps[stepIndex].captures.filter((_, i) => i !== captureIndex),
    });

  return (
    <div className="ws-steps">
      <p className="ws-workspace__hint">
        Steps run when this request is executed by the Collection Runner. Each one sends a message,
        waits for a specific reply, then checks and captures from it.
      </p>

      {steps.length === 0 && <p className="ws-log__empty">No steps yet.</p>}

      {steps.map((step, index) => (
        <div className="ws-step" key={step.id || index}>
          <div className="ws-step__head">
            <span className="ws-step__index">{index + 1}</span>
            <input
              className="ws-step__name"
              type="text"
              placeholder={`Step ${index + 1}`}
              value={step.name}
              onChange={(e) => patchStep(index, { name: e.target.value })}
            />
            <button className="ws-step__remove" onClick={() => removeStep(index)} aria-label="Remove step">
              <Icon name="close" size={12} />
            </button>
          </div>

          <label className="ws-settings__field">
            Send
            <textarea
              rows={2}
              placeholder='{"action":"subscribe"}'
              value={step.send}
              onChange={(e) => patchStep(index, { send: e.target.value })}
              spellCheck={false}
            />
          </label>

          <div className="ws-step__wait">
            <span className="ws-step__label">Wait for</span>
            <select
              value={step.waitFor.strategy}
              onChange={(e) => patchWait(index, { strategy: e.target.value })}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            {step.waitFor.strategy === 'jsonPath' && (
              <input
                type="text"
                placeholder="$.type"
                value={step.waitFor.path}
                onChange={(e) => patchWait(index, { path: e.target.value })}
              />
            )}

            {step.waitFor.strategy !== 'next' && step.waitFor.strategy !== 'silence' && (
              <input
                type="text"
                placeholder="expected"
                value={step.waitFor.value}
                onChange={(e) => patchWait(index, { value: e.target.value })}
              />
            )}

            <input
              className="ws-step__timeout"
              type="number"
              min="100"
              step="500"
              value={step.waitFor.timeoutMs}
              onChange={(e) => patchWait(index, { timeoutMs: Number(e.target.value) })}
              title="Timeout in milliseconds"
            />
            <span className="ws-step__label">ms</span>
          </div>

          <div className="ws-step__section">
            <div className="ws-step__section-head">
              <span className="ws-step__label">Assertions</span>
              <button onClick={() => addAssertion(index)}>+ Add</button>
            </div>
            {(step.assertions || []).map((assertion, ai) => (
              <div className="ws-step__row" key={assertion.id || ai}>
                <select
                  value={assertion.source}
                  onChange={(e) =>
                    patchAssertion(index, ai, {
                      source: e.target.value,
                      operator: OPERATORS[e.target.value][0],
                    })
                  }
                >
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>

                {assertion.source === 'json' && (
                  <input
                    type="text"
                    placeholder="$.type"
                    value={assertion.path}
                    onChange={(e) => patchAssertion(index, ai, { path: e.target.value })}
                  />
                )}

                <select
                  value={assertion.operator}
                  onChange={(e) => patchAssertion(index, ai, { operator: e.target.value })}
                >
                  {(OPERATORS[assertion.source] || []).map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>

                {!NO_VALUE.has(assertion.operator) && (
                  <input
                    type="text"
                    placeholder="expected"
                    value={assertion.expected}
                    onChange={(e) => patchAssertion(index, ai, { expected: e.target.value })}
                  />
                )}

                <button onClick={() => removeAssertion(index, ai)} aria-label="Remove assertion">
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="ws-step__section">
            <div className="ws-step__section-head">
              <span className="ws-step__label">Captures</span>
              <button onClick={() => addCapture(index)}>+ Add</button>
            </div>
            {(step.captures || []).map((capture, ci) => (
              <div className="ws-step__row" key={capture.id || ci}>
                <select
                  value={capture.source}
                  onChange={(e) => patchCapture(index, ci, { source: e.target.value })}
                >
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {capture.source === 'json' && (
                  <input
                    type="text"
                    placeholder="$.data.id"
                    value={capture.path}
                    onChange={(e) => patchCapture(index, ci, { path: e.target.value })}
                  />
                )}
                <input
                  type="text"
                  placeholder="variable name"
                  value={capture.variableName}
                  onChange={(e) => patchCapture(index, ci, { variableName: e.target.value })}
                />
                <button onClick={() => removeCapture(index, ci)} aria-label="Remove capture">
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button className="ws-steps__add" onClick={addStep}>
        + Add Step
      </button>
    </div>
  );
}
