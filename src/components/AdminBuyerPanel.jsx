export function AdminBuyerPanel({
  buyerError,
  buyerForm,
  buyerSearch,
  buyerStatus,
  editingBuyerCode,
  filteredBuyers,
  onRemoveBuyer,
  onStartBuyerCreate,
  onStartBuyerEdit,
  onSubmitBuyer,
  savingBuyer,
  setBuyerForm,
  setBuyerSearch,
}) {
  return (
    <section className="admin-grid">
      <section className="panel admin-list-panel">
        <div className="panel-header panel-header-row">
          <div>
            <h2>Buyers</h2>
            <p>Live master records stored in SQLite.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onStartBuyerCreate} disabled={savingBuyer}>
            New buyer
          </button>
        </div>

        <label className="search-field">
          <span>Search buyers</span>
          <input value={buyerSearch} onChange={(event) => setBuyerSearch(event.target.value)} placeholder="Search by code, name, GSTIN, city" />
        </label>

        <div className="admin-list">
          {filteredBuyers.map((buyer) => (
            <button
              key={buyer.Buyer_Code}
              className={`admin-list-card ${editingBuyerCode === buyer.Buyer_Code ? 'admin-list-card-active' : ''}`}
              type="button"
              onClick={() => onStartBuyerEdit(buyer)}
            >
              <div>
                <strong>{buyer.Buyer_Name}</strong>
                <span>{buyer.Buyer_Code}</span>
              </div>
              <small>{buyer.GSTIN || 'No GSTIN saved'}</small>
            </button>
          ))}
        </div>
      </section>

      <form className="panel admin-form-panel" onSubmit={onSubmitBuyer}>
        <div className="panel-header">
          <h2>{editingBuyerCode ? `Edit buyer ${editingBuyerCode}` : 'Create buyer'}</h2>
          <p>Changes save directly into the SQLite master database.</p>
        </div>

        <div className="admin-form-grid">
          <label>
            <span>Buyer code</span>
            <input
              value={buyerForm.Buyer_Code}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Buyer_Code: event.target.value }))}
              disabled={Boolean(editingBuyerCode)}
              placeholder="B006"
              required
            />
          </label>

          <label className="field-span-2">
            <span>Buyer name</span>
            <input
              value={buyerForm.Buyer_Name}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Buyer_Name: event.target.value }))}
              placeholder="New buyer name"
              required
            />
          </label>

          <label className="field-span-2">
            <span>Address line 1</span>
            <input
              value={buyerForm.Address_Line1}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Address_Line1: event.target.value }))}
            />
          </label>

          <label>
            <span>Address line 2</span>
            <input
              value={buyerForm.Address_Line2}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Address_Line2: event.target.value }))}
            />
          </label>

          <label>
            <span>Address line 3</span>
            <input
              value={buyerForm.Address_Line3}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Address_Line3: event.target.value }))}
            />
          </label>

          <label className="field-span-2">
            <span>City / State / PIN</span>
            <input
              value={buyerForm.City_State_Pin}
              onChange={(event) => setBuyerForm((current) => ({ ...current, City_State_Pin: event.target.value }))}
            />
          </label>

          <label>
            <span>GSTIN</span>
            <input
              value={buyerForm.GSTIN}
              onChange={(event) => setBuyerForm((current) => ({ ...current, GSTIN: event.target.value }))}
            />
          </label>

          <label>
            <span>Ship to name</span>
            <input
              value={buyerForm.Ship_To_Name}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Ship_To_Name: event.target.value }))}
            />
          </label>

          <label className="field-span-2">
            <span>Ship to address</span>
            <input
              value={buyerForm.Ship_To_Address}
              onChange={(event) => setBuyerForm((current) => ({ ...current, Ship_To_Address: event.target.value }))}
            />
          </label>
        </div>

        {buyerError ? <p className="error-banner">{buyerError}</p> : null}
        {buyerStatus ? <p className="success-banner">{buyerStatus}</p> : null}

        <div className="admin-actions">
          <button className="primary-button" type="submit" disabled={savingBuyer}>
            {savingBuyer ? 'Saving buyer...' : editingBuyerCode ? 'Update buyer' : 'Create buyer'}
          </button>
          <button className="secondary-button" type="button" onClick={onStartBuyerCreate} disabled={savingBuyer}>
            Clear form
          </button>
          {editingBuyerCode ? (
            <button className="danger-button" type="button" onClick={onRemoveBuyer} disabled={savingBuyer}>
              Delete buyer
            </button>
          ) : null}
        </div>
      </form>
    </section>
  )
}
