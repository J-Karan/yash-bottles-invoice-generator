function AdminAuthPanel({
  adminPasswordInput,
  setAdminPasswordInput,
  showAdminPassword,
  setShowAdminPassword,
  authError,
  authBusy,
  onSubmit,
}) {
  return (
    <section className="admin-auth-shell">
      <form className="panel admin-auth-panel" onSubmit={onSubmit}>
        <div className="panel-header admin-auth-top">
          <p className="admin-auth-eyebrow">Restricted Workspace</p>
          <h2>Admin Login Required</h2>
          <p>Buyer and item management are protected. Set <code>ADMIN_PASSWORD</code> on the server for live use.</p>
        </div>

        <div className="admin-auth-note">
          <strong>Protected actions</strong>
          <p>Create, edit, and delete buyer and item master records.</p>
        </div>

        <label className="admin-auth-field">
          <span>Admin password</span>
          <div className="admin-auth-input-row">
            <input
              type={showAdminPassword ? 'text' : 'password'}
              value={adminPasswordInput}
              onChange={(event) => setAdminPasswordInput(event.target.value)}
              placeholder="Enter admin password"
              autoComplete="current-password"
              required
            />
            <button
              className="text-button admin-auth-toggle"
              type="button"
              onClick={() => setShowAdminPassword((current) => !current)}
            >
              {showAdminPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <p className="hint-text admin-auth-hint">
          Use the admin password configured on the server.
        </p>
        {authError ? <p className="error-banner">{authError}</p> : null}

        <button className="primary-button admin-auth-submit" type="submit" disabled={authBusy}>
          {authBusy ? 'Signing in...' : 'Log in as admin'}
        </button>
      </form>
    </section>
  )
}

export { AdminAuthPanel }
