import { formatMoney } from '../invoice-utils.js'

export function AdminItemPanel({
  editingItemCode,
  filteredItems,
  itemError,
  itemForm,
  itemSearch,
  itemStatus,
  onRemoveItem,
  onStartItemCreate,
  onStartItemEdit,
  onSubmitItem,
  savingItem,
  setItemForm,
  setItemSearch,
}) {
  return (
    <section className="admin-grid">
      <section className="panel admin-list-panel">
        <div className="panel-header panel-header-row">
          <div>
            <h2>Items</h2>
            <p>Update rates and packing data without editing CSV files.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onStartItemCreate} disabled={savingItem}>
            New item
          </button>
        </div>

        <label className="search-field">
          <span>Search items</span>
          <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Search by code, description, category, alias" />
        </label>

        <div className="admin-list">
          {filteredItems.map((item) => (
            <button
              key={item.Item_Code}
              className={`admin-list-card ${editingItemCode === item.Item_Code ? 'admin-list-card-active' : ''}`}
              type="button"
              onClick={() => onStartItemEdit(item)}
              disabled={savingItem}
            >
              <div>
                <strong>{item.Description}</strong>
                <span>{item.Item_Code}</span>
              </div>
              <small>{formatMoney(item.Gross_Rate)}</small>
            </button>
          ))}
          {!filteredItems.length ? (
            <p className="empty-state">No items match this search.</p>
          ) : null}
        </div>
      </section>

      <form className="panel admin-form-panel" onSubmit={onSubmitItem}>
        <div className="panel-header">
          <h2>{editingItemCode ? `Edit item ${editingItemCode}` : 'Create item'}</h2>
          <p>Rates saved here will immediately affect future invoices.</p>
        </div>

        <div className="admin-form-grid">
          <label>
            <span>Item code</span>
            <input
              value={itemForm.Item_Code}
              onChange={(event) => setItemForm((current) => ({ ...current, Item_Code: event.target.value }))}
              disabled={Boolean(editingItemCode)}
              placeholder="IT009"
              required
            />
          </label>

          <label className="field-span-2">
            <span>Description</span>
            <input
              value={itemForm.Description}
              onChange={(event) => setItemForm((current) => ({ ...current, Description: event.target.value }))}
              required
            />
          </label>

          <label>
            <span>HSN code</span>
            <input
              value={itemForm.HSN_Code}
              onChange={(event) => setItemForm((current) => ({ ...current, HSN_Code: event.target.value }))}
            />
          </label>

          <label>
            <span>Category</span>
            <input
              value={itemForm.Category}
              onChange={(event) => setItemForm((current) => ({ ...current, Category: event.target.value }))}
            />
          </label>

          <label>
            <span>Gross rate</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={itemForm.Gross_Rate}
              onChange={(event) => setItemForm((current) => ({ ...current, Gross_Rate: event.target.value }))}
              required
            />
          </label>

          <label>
            <span>Non-taxable rate</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={itemForm.Non_Taxable_Rate}
              onChange={(event) =>
                setItemForm((current) => ({ ...current, Non_Taxable_Rate: event.target.value }))
              }
              required
            />
          </label>

          <label>
            <span>Bottles per bag</span>
            <input
              type="number"
              min="1"
              step="1"
              value={itemForm.Bottles_Per_Bag}
              onChange={(event) =>
                setItemForm((current) => ({ ...current, Bottles_Per_Bag: event.target.value }))
              }
              required
            />
          </label>

          <label className="field-span-2">
            <span>Dad writes as</span>
            <input
              value={itemForm.Dad_Writes_As}
              onChange={(event) => setItemForm((current) => ({ ...current, Dad_Writes_As: event.target.value }))}
            />
          </label>
        </div>

        {itemError ? <p className="error-banner">{itemError}</p> : null}
        {itemStatus ? <p className="success-banner">{itemStatus}</p> : null}

        <div className="admin-actions">
          <button className="primary-button" type="submit" disabled={savingItem}>
            {savingItem ? 'Saving item...' : editingItemCode ? 'Update item' : 'Create item'}
          </button>
          <button className="secondary-button" type="button" onClick={onStartItemCreate} disabled={savingItem}>
            Clear form
          </button>
          {editingItemCode ? (
            <button className="danger-button" type="button" onClick={onRemoveItem} disabled={savingItem}>
              Delete item
            </button>
          ) : null}
        </div>
      </form>
    </section>
  )
}
