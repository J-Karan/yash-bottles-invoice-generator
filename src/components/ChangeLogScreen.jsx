const changeLogEntries = [
  {
    version: '0.1.4',
    title: 'Workspace polish',
    changes: [
      'Updated typography and interactive feedback for daily use.',
      'Added accessible modal keyboard behavior and invoice success notifications.',
      'Replaced the large workspace hero with a compact summary bar.',
    ],
  },
  {
    version: '0.1.3',
    title: 'Changelog layout update',
    changes: [
      'Improved changelog scrolling and layout.',
      'Kept the update history controls visible while reading release notes.',
    ],
  },
  {
    version: '0.1.2',
    title: 'Stability update',
    changes: [
      'Made invoice generation publish files only after the invoice record is safely saved.',
      'Added rate validation to prevent negative taxable values.',
      'Fixed India-time invoice dates and date-only display across the app.',
    ],
  },
  {
    version: '0.1.1',
    title: 'Software update',
    changes: [
      'Added a version link to the login page.',
      'Added this changelog page for update history.',
      'Kept invoice history total amounts on one line in the desktop table.',
    ],
  },
  {
    version: '0.1.0',
    title: 'Initial workspace release',
    changes: [
      'Invoice generation with protected Excel and PDF downloads.',
      'E-way JSON support for generated invoice data.',
      'SQLite-backed buyer and item master data management.',
      'Invoice history, payment tracking, and admin-protected maintenance tools.',
    ],
  },
]

function ChangeLogScreen({ appVersion, onBackToLogin }) {
  const latestEntry = changeLogEntries[0]

  return (
    <main className="login-shell changelog-page">
      <section className="changelog-shell">
        <aside className="changelog-hero">
          <div className="changelog-hero-top">
            <p className="eyebrow">Yash Bottles</p>
            <span>Latest</span>
          </div>

          <div className="changelog-title-block">
            <h1>Release notes</h1>
            <p>Track each software update for the invoice workspace.</p>
          </div>

          <div className="changelog-summary-grid" aria-label="Changelog summary">
            <div>
              <span>Current version</span>
              <strong>{appVersion}</strong>
            </div>
            <div>
              <span>Total updates</span>
              <strong>{changeLogEntries.length}</strong>
            </div>
            <div>
              <span>Latest update</span>
              <strong>{latestEntry.title}</strong>
            </div>
          </div>
        </aside>

        <section className="changelog-panel" aria-labelledby="changelog-title">
          <div className="panel-header panel-header-row">
            <div>
              <h2 id="changelog-title">Update history</h2>
              <p>Versioned notes for user-facing updates.</p>
            </div>
            <button className="secondary-button changelog-back" type="button" onClick={onBackToLogin}>
              Back to login
            </button>
          </div>

          <div className="changelog-timeline">
            {changeLogEntries.map((entry, index) => (
              <article className="changelog-entry" key={entry.version}>
                <div className="changelog-marker" aria-hidden="true" />
                <div className="changelog-entry-body">
                  <div className="changelog-entry-head">
                    <div>
                      <span>Version {entry.version}</span>
                      <h3>{entry.title}</h3>
                    </div>
                    {index === 0 ? <strong className="changelog-latest-pill">Current</strong> : null}
                  </div>
                  <ul>
                    {entry.changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}

export { ChangeLogScreen }
