import './tab-bar.css';

// tabs: [{ id, label, count? }]
export default function TabBar({ tabs, activeTab, onChange }) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`tab-bar__tab ${activeTab === tab.id ? 'tab-bar__tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count > 0 && <span className="tab-bar__badge">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
