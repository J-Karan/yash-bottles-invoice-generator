import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'invoice-tests-'))
const env = {
  ...process.env,
  INVOICE_RUNTIME_DIR: runtime,
  INVOICE_TEST_RUNTIME: '1',
  APP_USERNAME: 'jkaran', APP_PASSWORD: 'test-app-password',
  ADMIN_PASSWORD: 'test-admin-password', PAYMENT_PASSWORD: 'test-payment-password',
}
try {
  await fs.mkdir(path.join(runtime, 'data', 'masters'), { recursive: true })
  await fs.writeFile(path.join(runtime, 'data', 'masters', 'Buyers_Master.csv'),
    'Buyer_Code,Buyer_Name,Address_Line1,City_State_Pin,GSTIN\n' +
    ['B001', 'B005', 'B008'].map((code) => `${code},Test Buyer ${code},Test Road,Pune Maharashtra 411046,27ABCDE1234F1Z5`).join('\n'))
  await fs.writeFile(path.join(runtime, 'data', 'masters', 'Items_Master.csv'),
    'Item_Code,Description,HSN_Code,Gross_Rate,Non_Taxable_Rate,Bottles_Per_Bag\nI001,Test Bottle,7010,10,2,100\n')
  await run(['--input-type=module', '-e', `
    const core = await import('./server/invoice-core.js');
    await core.dbReady;
    await core.generateAndSaveInvoice({buyerCode:'B001',shipToOptionId:'bill_to',
      vehicleNumber:'MH12AB1234',invoiceDate:'2026-05-01',lineItems:[{itemCode:'I001',bags:'1'}]});
  `])
  const files = []
  for (const directory of ['server', 'src']) {
    for (const file of await fs.readdir(directory)) {
      if (file.endsWith('.test.js')) files.push(`${directory}/${file}`)
    }
  }
  await run(['--test', '--test-concurrency=1', ...files])
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await fs.rm(runtime, { recursive: true, force: true })
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Test process exited with ${code}`)))
  })
}
