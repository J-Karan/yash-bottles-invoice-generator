const views = [
  { id: 'invoice', label: 'Invoice Workspace' },
  { id: 'history', label: 'Invoice History' },
  { id: 'buyers', label: 'Manage Buyers' },
  { id: 'items', label: 'Manage Items' },
]

function WorkspaceSwitcher({
  activeView,
  setActiveView,
  adminToken,
  onAdminLogout,
  onAppLogout,
}) {
  return (
    <section className="workspace-switcher">
      {views.map((view) => (
        <button
          key={view.id}
          className={`view-chip ${activeView === view.id ? 'view-chip-active' : ''}`}
          type="button"
          onClick={() => setActiveView(view.id)}
        >
          {view.label}
        </button>
      ))}
      {adminToken ? (
        <button className="view-chip" type="button" onClick={onAdminLogout}>
          Log Out Admin
        </button>
      ) : null}
      <button className="view-chip" type="button" onClick={onAppLogout}>
        Log Out
      </button>
    </section>
  )
}

export { WorkspaceSwitcher }
