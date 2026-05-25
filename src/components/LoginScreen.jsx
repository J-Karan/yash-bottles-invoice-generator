function LoginScreen({
  loginUsername,
  setLoginUsername,
  loginPassword,
  setLoginPassword,
  showLoginPassword,
  setShowLoginPassword,
  loginError,
  loginBusy,
  onSubmit,
}) {
  return (
    <main className="login-shell">
      <section className="login-hero">
        <div className="login-copy">
          <p className="eyebrow">Yash Bottles</p>
          <h1>Invoice workspace access</h1>
          <p>
            Sign in to generate invoices, review history, manage master records, and download protected invoice files.
          </p>
          <div className="login-metrics" aria-hidden="true">
            <div>
              <span>Storage</span>
              <strong>SQLite</strong>
            </div>
            <div>
              <span>Output</span>
              <strong>Excel + PDF</strong>
            </div>
            <div>
              <span>E-way</span>
              <strong>JSON</strong>
            </div>
          </div>
        </div>

        <form className="login-panel" onSubmit={onSubmit}>
          <div className="panel-header">
            <h2>Log In</h2>
            <p>Use your invoice workspace credentials.</p>
          </div>

          <label>
            <span>Username</span>
            <input
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>

          <label>
            <span>Password</span>
            <div className="login-password-row">
              <input
                type={showLoginPassword ? 'text' : 'password'}
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button
                className="text-button login-password-toggle"
                type="button"
                onClick={() => setShowLoginPassword((current) => !current)}
              >
                {showLoginPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {loginError ? <p className="error-banner">{loginError}</p> : null}

          <button className="primary-button login-submit" type="submit" disabled={loginBusy}>
            {loginBusy ? 'Signing in...' : 'Enter Workspace'}
          </button>
        </form>
      </section>
    </main>
  )
}

export { LoginScreen }
