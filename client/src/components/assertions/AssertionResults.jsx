import { operatorLabel } from '../../hooks/useAssertions.js';
import { failureReason } from '../../utils/assertionFormat.js';

export default function AssertionResults({ assertions }) {
  if (!assertions) return null;

  const { results, passedCount, totalCount, allPassed } = assertions;

  return (
    <div className="assertion-results">
      <div
        className={`assertion-results__summary ${
          allPassed ? 'assertion-results__summary--pass' : 'assertion-results__summary--fail'
        }`}
      >
        <span className="assertion-results__verdict">{allPassed ? 'TEST PASSED' : 'TEST FAILED'}</span>
        <span className="assertion-results__count">
          {passedCount} / {totalCount} Assertions Passed
        </span>
      </div>

      <ul className="assertion-results__list">
        {results.map((result, index) => (
          <li
            key={index}
            className={`assertion-results__item ${result.pass ? 'pass' : 'fail'}`}
          >
            <span className="assertion-results__badge">{result.pass ? 'PASS' : 'FAIL'}</span>
            <div className="assertion-results__detail">
              <div className="assertion-results__expression">
                {result.label} {operatorLabel(result.source, result.operator)}
                {result.expected ? ` ${result.expected}` : ''}
              </div>
              {!result.pass && <div className="assertion-results__reason">{failureReason(result)}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
