import { useState } from 'react';
import SchemaViewer from './SchemaViewer.jsx';
import DocsExplorer from './DocsExplorer.jsx';

/**
 * One entry point for everything you can do with a loaded schema.
 *
 * These were two separate buttons opening two separate modals — "Browse Schema" and
 * "Docs" — over the same data. They answer the same question (what can I call here?)
 * by different routes: one by walking the structure, one by searching it. Making the
 * user pick before they have seen either, and close one to reach the other, was a
 * choice they had no basis to make. Now it is a tab.
 *
 * Both views are rendered unchanged; this only owns which one is showing.
 */
const SCHEMA_TABS = [
  { id: 'browse', label: 'Browse' },
  { id: 'search', label: 'Search' },
];

export default function SchemaExplorer({ schema, endpoint, onClose }) {
  const [tab, setTab] = useState('browse');

  // Passed down rather than imported by each view: the tab set belongs to whoever owns
  // the switching, and a child importing from its parent is a cycle waiting to happen.
  const shared = {
    schema,
    endpoint,
    onClose,
    tabs: SCHEMA_TABS,
    activeTab: tab,
    onTabChange: setTab,
  };

  return tab === 'browse' ? <SchemaViewer {...shared} /> : <DocsExplorer {...shared} />;
}
