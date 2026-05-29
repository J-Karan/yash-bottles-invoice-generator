import { expect, test } from '@playwright/test'

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

async function mockAuthenticatedApis(page) {
  await page.addInitScript(() => {
    localStorage.setItem('invoiceAppToken', 'ui-test-token')
  })
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/masters', (route) => route.fulfill({ json: { buyers, items } }))
  await page.route('**/api/invoices/history?limit=300', (route) =>
    route.fulfill({
      json: {
        invoices: [invoice],
        paymentSummary: { totalInvoices: 1, paidInvoices: 0, unpaidInvoices: 1, invoiceRate: 100, amountDue: 100, paidAmountTotal: 0 },
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
            distanceKm: 75,
            missingFields: [],
            warnings: [],
            ready: true,
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
  await expect(page.getByRole('button', { name: 'Version 0.1.4' })).toBeVisible()
  await page.getByRole('button', { name: 'Version 0.1.4' }).click()
  await expect(page.getByRole('heading', { name: 'Update history' })).toBeVisible()
  await expect(page.getByText('Version 0.1.4')).toBeVisible()
  await expect(page.getByText('Version 0.1.3')).toBeVisible()
  await expect(page.getByText('Version 0.1.2')).toBeVisible()
  await expect(page.getByText('Version 0.1.1')).toBeVisible()
  await expect(page.getByText('Version 0.1.0')).toBeVisible()
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
  await page.screenshot({ path: testInfo.outputPath('invoice-workspace.png'), fullPage: true })

  await page.getByLabel('Buyer name').selectOption('B002')
  await expect(page.getByLabel('Ship to address')).toHaveValue('bill_to')
  await page.getByRole('button', { name: 'Add item' }).click()
  const secondLineItem = page.locator('.line-items-list article').filter({ hasText: 'Item 2' })
  await expect(secondLineItem).toBeVisible()
  await page.getByRole('button', { name: 'Remove' }).last().click()
  await expect(secondLineItem).toHaveCount(0)

  await page.getByLabel('Vehicle number').fill('bad')
  await page.getByLabel('Invoice date').fill('2026-05-27')
  await page.getByRole('button', { name: 'Generate invoice' }).click()
  await expect(page.getByLabel('Vehicle number')).toHaveJSProperty('validity.valid', false)

  await page.getByLabel('Vehicle number').fill('MH12AB1234')
  await page.getByRole('button', { name: 'Generate invoice' }).click()
  await expect(page.getByText('Generated invoice')).toBeVisible()
  await expect(page.getByText('Invoice 001/2026-27 generated')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Excel' })).toBeVisible()
  const viewport = page.viewportSize()
  if (!viewport || viewport.width > 960) {
    await expect(page.locator('.preview-panel')).toHaveCSS('overflow-y', 'auto')
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
  await page.screenshot({ path: testInfo.outputPath('history-tab.png'), fullPage: true })

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
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const paymentFocusInsideModal = await page.evaluate(() => document.querySelector('.modal-card')?.contains(document.activeElement))
  expect(paymentFocusInsideModal).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Confirm Payment' })).toHaveCount(0)

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

test('mobile layout keeps invoice and history actions reachable', async ({ page }, testInfo) => {
  await mockAuthenticatedApis(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Invoice details' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('mobile-invoice-workspace.png'), fullPage: true })

  await page.getByRole('button', { name: 'Invoice History' }).click()
  await expectAnyVisibleText(page, 'Acme Packaging')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('mobile-history-view.png'), fullPage: true })
})
