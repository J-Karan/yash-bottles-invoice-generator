import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const appVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
).version

const buyers = [
  {
    Buyer_Code: 'B001',
    Buyer_Name: 'Acme Packaging',
    Address_Line1: 'Factory Road',
    Address_Line2: 'Industrial Area',
    Address_Line3: 'Pune',
    City_State_Pin: 'Pune, Maharashtra 411046',
    GSTIN: '27ABCDE1234F1Z5',
    Ship_To_Name: 'Acme Warehouse',
    Ship_To_Address: 'MIDC Lonand 415521',
    Ship_To_Options: [
      {
        id: 'bill_to',
        label: 'Bill To (Same as buyer address)',
        shipToName: 'SAME As TO',
        shipToAddress: '',
      },
      {
        id: 'master_ship_to',
        label: 'Master Ship-To: Acme Warehouse',
        shipToName: 'Acme Warehouse',
        shipToAddress: 'MIDC Lonand 415521',
      },
    ],
    Default_Ship_To_Option_Id: 'master_ship_to',
  },
  {
    Buyer_Code: 'B002',
    Buyer_Name: 'Zen Bottlers',
    Address_Line1: 'Market Yard',
    Address_Line2: '',
    Address_Line3: 'Pune',
    City_State_Pin: 'Pune, Maharashtra 411037',
    GSTIN: '27ABCDE1234F1Z6',
    Ship_To_Name: '',
    Ship_To_Address: '',
    Ship_To_Options: [
      {
        id: 'bill_to',
        label: 'Bill To (Same as buyer address)',
        shipToName: 'SAME As TO',
        shipToAddress: '',
      },
    ],
    Default_Ship_To_Option_Id: 'bill_to',
  },
]

const items = [
  {
    Item_Code: 'I001',
    Description: '200 ML Glass Bottle',
    HSN_Code: '7010',
    Gross_Rate: '12.00',
    Non_Taxable_Rate: '2.00',
    Bottles_Per_Bag: '50',
    Dad_Writes_As: '200ML',
    Category: 'Bottle',
  },
  {
    Item_Code: 'I002',
    Description: '500 ML Glass Bottle',
    HSN_Code: '7010',
    Gross_Rate: '18.00',
    Non_Taxable_Rate: '3.00',
    Bottles_Per_Bag: '40',
    Dad_Writes_As: '500ML',
    Category: 'Bottle',
  },
]

const invoice = {
  invoiceNumber: '001/2026-27',
  invoiceKey: '001-2026-27',
  invoiceDate: '2026-05-27',
  buyerName: 'Acme Packaging',
  buyerCode: 'B001',
  buyerGstin: '27ABCDE1234F1Z5',
  vehicleNumber: 'MH12AB1234',
  total: 1280,
  excelAvailable: true,
  pdfAvailable: true,
  files: {
    excel: '/downloads/excel/2026-27/05-May/001-2026-27.xlsx',
    pdf: '/downloads/pdf/2026-27/05-May/001-2026-27.pdf',
  },
}

const olderInvoice = {
  ...invoice,
  invoiceNumber: '000/2026-27',
  invoiceKey: '000-2026-27',
  invoiceDate: '2026-05-20',
  vehicleNumber: 'MH12AB0000',
  files: {
    excel: '/downloads/excel/2026-27/05-May/000-2026-27.xlsx',
    pdf: '/downloads/pdf/2026-27/05-May/000-2026-27.pdf',
  },
}

async function mockAuthenticatedApis(page) {
  await page.addInitScript(() => {
    localStorage.setItem('invoiceAppToken', 'ui-test-token')
  })
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/masters', (route) => route.fulfill({ json: { buyers, items } }))
  await page.route('**/api/invoices/history?*', (route) =>
    route.fulfill({
      json: {
        invoices: [invoice, olderInvoice],
        paymentSummary: { totalInvoices: 2, paidInvoices: 0, unpaidInvoices: 2, invoiceRate: 100, amountDue: 200, paidAmountTotal: 0 },
      },
    }),
  )
  await page.route('**/api/eway/readiness', (route) =>
    route.fulfill({
      json: {
        summary: { total: 1, ready: 1, needsInput: 0 },
        invoices: [
          {
            ...invoice,
            lineCount: 1,
            distanceKm: 0,
            missingFields: ['distance_km'],
            warnings: [],
            ready: false,
          },
        ],
      },
    }),
  )
  await page.route('**/api/invoices/generate', (route) =>
    route.fulfill({
      json: {
        invoice: {
          invoiceNumber: invoice.invoiceNumber,
          invoiceKey: invoice.invoiceKey,
        },
        files: invoice.files,
      },
    }),
  )
  await page.route('**/api/admin/session', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/admin/login', (route) => route.fulfill({ json: { token: 'admin-ui-test-token' } }))
  await page.route('**/api/invoices/mark-paid', (route) =>
    route.fulfill({ json: { markedCount: 1, summary: { totalInvoices: 1, paidInvoices: 1, unpaidInvoices: 0, invoiceRate: 100, amountDue: 0, paidAmountTotal: 100 } } }),
  )
}

async function expectNoHorizontalOverflow(page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(hasOverflow).toBe(false)
}

test('master loading can recover and logout removes the previous draft', async ({ page }) => {
  await mockAuthenticatedApis(page)
  let fail = true
  await page.route('**/api/masters', route => route.fulfill(fail
    ? { status: 503, json: { error: 'Masters unavailable' } }
    : { json: { buyers, items } }))
  await page.route('**/api/auth/logout', route => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/auth/login', route => route.fulfill({ json: { token: 'new-session' } }))
  await page.goto('/')
  await expect(page.getByText('Masters unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate invoice' })).toBeDisabled()
  fail = false
  await page.getByRole('button', { name: 'Retry loading buyers and items' }).click()
  await page.getByLabel('Vehicle number').fill('MH12ZZ9999')
  await page.getByRole('button', { name: 'Log Out', exact: true }).click()
  await page.getByLabel('Username').fill('test-user')
  await page.getByLabel('Password', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Enter Workspace' }).click()
  await expect(page.getByLabel('Vehicle number')).not.toHaveValue('MH12ZZ9999')
})

test('saving locks inputs and explicit regeneration preserves the saved invoice key', async ({ page }) => {
  await mockAuthenticatedApis(page)
  const requests = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/api/invoices/generate', async route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) await gate
    await route.fulfill({ json: { invoice: { invoiceNumber: invoice.invoiceNumber, invoiceKey: invoice.invoiceKey }, files: invoice.files } })
  })
  await page.goto('/')
  await page.getByLabel('Vehicle number').fill('MH12AB1234')
  await page.getByRole('button', { name: 'Generate invoice', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Generating files...' })).toBeDisabled()
  await expect(page.getByLabel('Number of bags')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Log Out', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('button', { name: 'Invoice saved', exact: true })).toBeDisabled()
  expect(requests).toHaveLength(1)
  await page.getByRole('button', { name: 'Edit saved invoice' }).click()
  await page.getByLabel('Number of bags').fill('2')
  await page.getByRole('button', { name: 'Regenerate invoice' }).click()
  await expect(page.getByRole('button', { name: 'Invoice saved', exact: true })).toBeDisabled()
  expect(requests[1].editInvoiceKey).toBe(invoice.invoiceKey)
  await page.getByRole('button', { name: 'Start new invoice' }).click()
  await expect(page.getByRole('button', { name: 'Generate invoice', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Download Excel' })).toHaveCount(0)
})

test('admin edits require save or discard before switching records and views', async ({ page }) => {
  await mockAuthenticatedApis(page)
  await page.addInitScript(() => localStorage.setItem('invoiceAdminToken', 'admin-test'))
  await page.route('**/api/buyers/B001', route => route.fulfill({ json: { buyer: route.request().postDataJSON() } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Manage Buyers' }).click()
  await page.locator('.admin-list-card').first().click()
  if (page.viewportSize().width <= 960) await expect(page.getByRole('heading', { name: 'Edit buyer B001' })).toBeFocused()
  await page.getByLabel('Buyer name', { exact: true }).fill('Changed buyer')
  await page.getByRole('button', { name: 'Manage Items' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByLabel('Buyer name', { exact: true })).toHaveValue('Changed buyer')
  await page.locator('.admin-list-card').last().click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByLabel('Buyer name', { exact: true })).toHaveValue('Zen Bottlers')
  await page.locator('.admin-list-card').first().click()
  await page.getByLabel('Buyer name', { exact: true }).fill('Saved buyer')
  await page.getByRole('button', { name: 'Manage Items' }).click()
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible()
})

test('expired app session during an admin save returns to workspace login', async ({ page }) => {
  await mockAuthenticatedApis(page)
  await page.addInitScript(() => localStorage.setItem('invoiceAdminToken', 'admin-test'))
  await page.route('**/api/buyers/B001', route => route.fulfill({ status: 401, json: { error: 'Session expired. Log in again.' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Manage Buyers' }).click()
  await page.locator('.admin-list-card').first().click()
  await page.getByLabel('Buyer name', { exact: true }).fill('Unsaved buyer')
  await page.getByRole('button', { name: 'Update buyer' }).click()
  await expect(page.getByRole('heading', { name: 'Invoice workspace access' })).toBeVisible()
  await expect(page.getByText('Session expired. Log in again.')).toBeVisible()
})

test('history pages and searches the archive through the server', async ({ page }) => {
  await mockAuthenticatedApis(page)
  await page.route('**/api/invoices/history?*', route => {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset'))
    const search = url.searchParams.get('search')
    return route.fulfill({ json: {
      invoices: [{ ...invoice, buyerName: search ? 'Archive match' : offset ? 'Older page' : 'Newest page', canDelete: !offset && !search }],
      pagination: { offset, limit: 50, total: search ? 1 : 351 },
    } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Invoice History' }).click()
  await expect(page.getByText('Newest page', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('Older page', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete invoice 001/2026-27' })).toHaveCount(0)
  await page.getByPlaceholder('Invoice no, buyer, date, vehicle, GSTIN').fill('archive')
  await expect(page.getByText('Showing 1–1 of 1 matching invoices')).toBeVisible()
  await expectAnyVisibleText(page, 'Archive match')
})

async function expectAnyVisibleText(page, text) {
  const matches = page.getByText(text)
  const count = await matches.count()
  let visible = false
  for (let index = 0; index < count; index += 1) {
    visible ||= await matches.nth(index).isVisible()
  }
  expect(visible).toBe(true)
}

test('login screen renders and invalid login reports an error', async ({ page }, testInfo) => {
  await page.route('**/api/auth/login', (route) => route.fulfill({ status: 401, json: { error: 'Invalid username or password.' } }))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Invoice workspace access' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Version ${appVersion}` })).toBeVisible()
  await page.getByRole('button', { name: `Version ${appVersion}` }).click()
  await expect(page.getByRole('heading', { name: 'Update history' })).toBeVisible()
  await expect(page.getByText(`Version ${appVersion}`, { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.3.4', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.3.3', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.3.1', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.3.0', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.1.5', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.1.4', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.1.3', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.1.2', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.1.1', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 0.1.0', { exact: true })).toBeVisible()
  const viewport = page.viewportSize()
  if (!viewport || viewport.width > 960) {
    await expect(page.locator('.changelog-timeline')).toHaveCSS('overflow-y', 'auto')
  }
  await expect(page.getByRole('button', { name: 'Back to login' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Back to login' }).click()
  await expect(page.getByRole('heading', { name: 'Invoice workspace access' })).toBeVisible()
  await page.getByLabel('Username').fill('wrong')
  await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: 'Enter Workspace' }).click()

  await expect(page.getByText('Invalid username or password.')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('login-screen.png'), fullPage: true })
})

test('invoice workspace supports core interactions', async ({ page }, testInfo) => {
  await mockAuthenticatedApis(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Invoice details' })).toBeVisible()
  await expect(page.locator('.workspace-bar')).toBeVisible()
  await expect(page.getByText('Yash Bottles')).toBeVisible()
  await expect(page.getByText('Invoice Generator')).toBeVisible()
  await expect(page.locator('.workspace-version')).toHaveText(`Version ${appVersion}`)
  const workspaceBrandFontSize = await page.locator('.workspace-brand').evaluate((element) => Number.parseFloat(window.getComputedStyle(element).fontSize))
  expect(workspaceBrandFontSize).toBeGreaterThanOrEqual(21)
  await expect(page.locator('.workspace-bar-metrics')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('invoice-workspace.png'), fullPage: true })

  await page.getByLabel('Buyer name').selectOption('B002')
  await expect(page.getByLabel('Ship to address')).toHaveValue('bill_to')
  await page.getByRole('button', { name: 'Add item' }).click()
  const secondLineItem = page.locator('.line-items-list article').filter({ hasText: 'Item 2' })
  await expect(secondLineItem).toBeVisible()
  await page.getByRole('button', { name: 'Remove' }).last().click()
  await expect(secondLineItem).toHaveCount(0)

  await expect(page.getByText('Format example: MH12AB1234. Spaces are removed automatically.')).toHaveCount(0)
  await page.getByLabel('Vehicle number').fill('')
  await page.getByLabel('Invoice date').fill('2026-05-27')
  await page.getByRole('button', { name: 'Generate invoice' }).click()
  await expect(page.getByLabel('Vehicle number')).toHaveJSProperty('validity.valid', false)

  await page.getByLabel('Vehicle number').fill('bad')
  await page.getByRole('button', { name: 'Generate invoice' }).click()
  await expect(page.getByLabel('Vehicle number')).toHaveJSProperty('validity.valid', false)

  await page.getByLabel('Vehicle number').fill('MH12AB1234')
  await page.getByRole('button', { name: 'Generate invoice' }).click()
  await expect(page.getByText('Generated invoice')).toBeVisible()
  await expect(page.getByText('Invoice 001/2026-27 generated')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Excel' })).toBeVisible()
  await expect(page.getByLabel('Vehicle number')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Invoice saved', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Edit saved invoice' }).click()
  await expect(page.getByRole('button', { name: 'Download Excel' })).toHaveCount(0)
  await expect(page.getByLabel('Vehicle number')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Regenerate invoice' })).toBeEnabled()
  const viewport = page.viewportSize()
  if (!viewport || viewport.width > 960) {
    await expect(page.locator('.preview-panel')).toHaveCSS('overflow-y', 'visible')
    const panelHeights = await page.evaluate(() => {
      const formPanel = document.querySelector('.form-panel')
      const previewPanel = document.querySelector('.preview-panel')
      return {
        form: formPanel?.getBoundingClientRect().height ?? 0,
        preview: previewPanel?.getBoundingClientRect().height ?? 0,
      }
    })
    expect(Math.abs(panelHeights.form - panelHeights.preview)).toBeLessThanOrEqual(1)
  }
  await expectNoHorizontalOverflow(page)
})

test('history, payment, and admin gates remain usable', async ({ page }, testInfo) => {
  await mockAuthenticatedApis(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Invoice History' }).click()
  await expect(page.getByRole('heading', { name: 'Invoice History' })).toBeVisible()
  await expectAnyVisibleText(page, 'Acme Packaging')
  await expect(page.locator('.history-total-cell').first()).toHaveCSS('white-space', 'nowrap')
  const visibleDistanceInput = page.locator('input[aria-label="Distance KM for 001/2026-27"]:visible')
  await expect(visibleDistanceInput).toBeVisible()
  await visibleDistanceInput.fill('75')
  await expect(page.locator('button:visible', { hasText: 'E-way JSON' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('history-tab.png'), fullPage: true })

  await expectAnyVisibleText(page, '000/2026-27')
  await expect(page.getByRole('button', { name: 'Delete invoice 001/2026-27' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Delete invoice 000/2026-27' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Delete' }).first().click()
  await expect(page.getByRole('heading', { name: 'Delete invoice 001/2026-27?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const deleteFocusInsideModal = await page.evaluate(() => document.querySelector('.modal-card')?.contains(document.activeElement))
  expect(deleteFocusInsideModal).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Delete invoice 001/2026-27?' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Delete' }).first().click()
  await expect(page.getByRole('heading', { name: 'Delete invoice 001/2026-27?' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('delete-confirmation-modal.png'), fullPage: true })
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Mark Paid' }).click()
  await expect(page.getByRole('heading', { name: 'Confirm Payment' })).toBeVisible()
  await page.getByLabel('Payment Password').fill('test-fee-password')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const paymentFocusInsideModal = await page.evaluate(() => document.querySelector('.modal-card')?.contains(document.activeElement))
  expect(paymentFocusInsideModal).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Confirm Payment' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mark Paid' })).toBeFocused()

  await page.getByRole('button', { name: 'Mark Paid' }).click()
  await expect(page.getByRole('heading', { name: 'Confirm Payment' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('payment-modal.png'), fullPage: true })
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Manage Buyers' }).click()
  await expect(page.getByRole('heading', { name: 'Admin Login Required' })).toBeVisible()
  await page.getByLabel('Admin password').fill('admin-pass')
  await page.getByRole('button', { name: 'Log in as admin' }).click()
  await expect(page.getByRole('heading', { name: 'Buyers' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('buyer-admin-tab.png'), fullPage: true })

  await page.getByRole('button', { name: 'Manage Items' }).click()
  await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('item-admin-tab.png'), fullPage: true })
  await expectNoHorizontalOverflow(page)
})

test('historical preview uses saved buyer and shipping details', async ({ page }) => {
  await mockAuthenticatedApis(page)
  await page.route('**/api/invoices/001-2026-27', (route) => route.fulfill({ json: {
    invoice: { ...invoice, lineItems: [], savedLines: [],
      savedTotals: { quantity: 0, taxableValue: 0, nonTaxableValue: 0, cgst: 0, sgst: 0, total: 0 },
      buyerSnapshot: { Buyer_Code: 'B001', Buyer_Name: 'Original Buyer Name',
        GSTIN: '27AAAAA1111A1Z1', Address_Line1: 'Original Billing Road',
        Address_Line2: '', Address_Line3: '', City_State_Pin: 'Pune 411046',
        Ship_To_Name: 'Original Warehouse', Ship_To_Address: 'Original Delivery Road 415521' },
    },
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Invoice History' }).click()
  await page.getByRole('button', { name: /Preview invoice 001\/2026-27/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Original Buyer Name', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Original Warehouse', { exact: true })).toBeVisible()
  await expect(dialog.getByText('27AAAAA1111A1Z1', { exact: false })).toBeVisible()
  await expect(dialog.getByText('Acme Packaging', { exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('mobile layout keeps invoice and history actions reachable', async ({ page }, testInfo) => {
  await mockAuthenticatedApis(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Invoice details' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('mobile-invoice-workspace.png'), fullPage: true })

  if (page.viewportSize().width <= 960) {
    for (let index = 1; index < 8; index++) await page.getByRole('button', { name: 'Add item', exact: true }).click()
    await page.locator('.line-item-card').nth(3).scrollIntoViewIfNeeded()
    const saveBar = await page.locator('.invoice-submit-bar').boundingBox()
    expect(saveBar.y).toBeGreaterThanOrEqual(0)
    expect(saveBar.y + saveBar.height).toBeLessThanOrEqual(page.viewportSize().height)
    await expect(page.getByRole('button', { name: 'Show invoice preview' })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Invoice History' }).click()
  await expectAnyVisibleText(page, 'Acme Packaging')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('mobile-history-view.png'), fullPage: true })
})
