import { useState } from 'react';
import TabBar from '../common/TabBar.jsx';
import ResponseBody from './ResponseBody.jsx';
import ResponseHeaders from './ResponseHeaders.jsx';

export default function ResponseTabs({ body, headers, status }) {
  const [activeTab, setActiveTab] = useState('body');

  const tabs = [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', count: Object.keys(headers || {}).length },
  ];

  return (
    <div className="response-tabs">
      <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="response-tabs__content">
        {activeTab === 'body' && <ResponseBody body={body} headers={headers} status={status} />}
        {activeTab === 'headers' && <ResponseHeaders headers={headers} />}
      </div>
    </div>
  );
}
