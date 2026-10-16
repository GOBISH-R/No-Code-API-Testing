import { lazy, Suspense, useState } from 'react';
import TabBar from '../common/TabBar.jsx';
import ParamsEditor from './ParamsEditor.jsx';
import HeadersEditor from './HeadersEditor.jsx';
import BodyEditor from './BodyEditor.jsx';
import AuthEditor from './AuthEditor.jsx';
import AssertionsEditor from '../assertions/AssertionsEditor.jsx';
import CapturesEditor from '../captures/CapturesEditor.jsx';

/**
 * Loaded on demand, because it brings CodeMirror with it.
 *
 * The editor stack is by far the heaviest thing this app depends on — around 180kB
 * gzipped, more than everything else combined — and it is only ever rendered for a
 * GraphQL request. Importing it eagerly meant every REST and WebSocket user downloaded
 * a syntax-highlighting engine they would never see.
 */
const GraphQLEditor = lazy(() => import('./GraphQLEditor.jsx'));

function activeCount(rows) {
  return rows.filter((r) => r.enabled && r.key.trim()).length;
}

export default function RequestTabs({
  protocol,
  params,
  headers,
  body,
  graphql,
  graphqlSchema,
  auth,
  assertions,
  captures,
}) {
  const [selectedTab, setActiveTab] = useState('params');
  const isGraphQL = protocol === 'graphql';

  // The Body/Query tab's id changes with the protocol; if that's the tab someone was on
  // when they switched, follow it rather than leaving the content pane on a dead id.
  // Worked out during render, so the right tab is there on the first paint.
  let activeTab = selectedTab;
  if (selectedTab === 'body' && isGraphQL) activeTab = 'query';
  if (selectedTab === 'query' && !isGraphQL) activeTab = 'body';

  const tabs = [
    { id: 'params', label: 'Params', count: activeCount(params.rows) },
    { id: 'headers', label: 'Headers', count: activeCount(headers.rows) },
    // GraphQL requests are always a generated JSON body (see executionEngine.js), so
    // the Body tab is replaced by a dedicated Query editor rather than shown alongside it.
    isGraphQL
      ? { id: 'query', label: 'Query', count: graphql.value.query.trim() ? 1 : 0 }
      : { id: 'body', label: 'Body', count: body.value.mode !== 'none' ? 1 : 0 },
    { id: 'auth', label: 'Auth', count: auth.value.type !== 'none' ? 1 : 0 },
    { id: 'tests', label: 'Tests', count: assertions.rows.length },
    { id: 'capture', label: 'Capture', count: captures.rows.length },
  ];

  return (
    <div className="request-tabs">
      <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="request-tabs__content">
        {activeTab === 'params' && <ParamsEditor params={params} />}
        {activeTab === 'headers' && <HeadersEditor headers={headers} />}
        {activeTab === 'body' && !isGraphQL && <BodyEditor body={body} />}
        {activeTab === 'query' && isGraphQL && (
          <Suspense fallback={<p className="request-tabs__loading">Loading the query editor…</p>}>
            <GraphQLEditor graphql={graphql} schemaState={graphqlSchema} />
          </Suspense>
        )}
        {activeTab === 'auth' && <AuthEditor auth={auth} />}
        {activeTab === 'tests' && <AssertionsEditor assertions={assertions} />}
        {activeTab === 'capture' && <CapturesEditor captures={captures} />}
      </div>
    </div>
  );
}
