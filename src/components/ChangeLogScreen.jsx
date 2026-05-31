const changeLogEntries = [
  {
    version: '0.2.0',
    title: 'Table layout refinement',
    changes: [
      'Prevented awkward text wrapping in history table column headers (e.g. Lines, Vehicle).',
      'Bumped system release version to v0.2.0.',
    ],
  },
  {
    version: '0.1.9',
    title: 'Invoice History Preview',
    changes: [
      'Added a read-only high-fidelity Invoice Preview Modal inside the Invoice History tab.',
      'Optimized real-time calculations matching the main invoice creation engine.',
      'Redesigned the history actions panel into a balanced 3-row grid layout.',
    ],
  },
  {
    version: '0.1.8',
    title: 'UI/UX bug fixes',
    changes: [
      'Fixed download grid alignment shifts in history when Excel or PDF files are missing.',
      'Prevented numeric scroll wheel increments on Number of Bags fields.',
      'Mitigated horizontal scrolling by upgrading responsive layout threshold to 960px.',
      'Improved legibility contrast for locked date inputs to meet accessibility standards.',
      'Added early E-way distance warning banner inside the invoice creation form.',
      'Integrated a fast "Clear Search" button inside the invoice history filters.',
    ],
  },
  {
    version: '0.1.7',
    title: 'Vehicle entry update',
    changes: [
      'Kept vehicle number required while removing the strict format validation.',
      'Removed the vehicle format helper text from the invoice form.',
    ],
  },
  {
    version: '0.1.6',
    title: 'Workspace header polish',
    changes: [
      'Added a cleaner branded workspace header with a subtitle and version pill.',
      'Kept the header compact without restoring the buyer, item, or row metrics.',
    ],
  },
  {
    version: '0.1.5',
    title: 'Workspace alignment update',
    changes: [
      'Improved workspace header and preview panel alignment.',
      'Removed the top-bar metrics from the logged-in workspace.',
      'Let the page handle invoice preview scrolling naturally.',
    ],
  },
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
