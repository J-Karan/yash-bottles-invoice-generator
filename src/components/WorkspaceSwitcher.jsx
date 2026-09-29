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
  busy = false,
}) {
  return (
    <nav className="workspace-switcher" aria-label="Workspace sections">
      {views.map((view) => (
        <button
          key={view.id}
          className={`view-chip ${activeView === view.id ? 'view-chip-active' : ''}`}
          type="button"
          disabled={busy}
          aria-current={activeView === view.id ? 'page' : undefined}
          onClick={() => setActiveView(view.id)}
        >
          {view.label}
        </button>
      ))}
      {adminToken ? (
        <button className="view-chip" type="button" disabled={busy} onClick={onAdminLogout}>
          Log Out Admin
        </button>
      ) : null}
      <button className="view-chip" type="button" disabled={busy} onClick={onAppLogout}>
        Log Out
      </button>
    </nav>
  )
}

export { WorkspaceSwitcher }
