const defaultBuyerShipToOptions = [
  {
    buyerCode: 'B001',
    optionId: 'carlsberg-lonand',
    label: 'Carlsberg India Pvt. Ltd. (PVL CO Brewery) - MIDC Lonand',
    shipToName: 'CARLSBERG INDIA PVT. LTD. (PVL CO BREWERY)',
    shipToAddress: 'Plot No. C2, MIDC Lonand, Tal. Khandala, Dist. Satara, Maharashtra, 415521',
  },
  {
    buyerCode: 'B005',
    optionId: 'carlsberg-lonand',
    label: 'Carlsberg India Pvt. Ltd. (PVL CO Brewery) - MIDC Lonand',
    shipToName: 'CARLSBERG INDIA PVT. LTD. (PVL CO BREWERY)',
    shipToAddress: 'Plot No. C2, MIDC Lonand, Tal. Khandala, Dist. Satara, Maharashtra, 415521',
  },
]


const defaultEwayInvoiceDistances = [
  ['086-2025-26', 241],
  ['087-2025-26', 246],
  ['088-2025-26', 241],
  ['089-2025-26', 246],
  ['090-2025-26', 241],
  ['091-2025-26', 241],
  ['092-2025-26', 246],
  ['093-2025-26', 246],
  ['094-2025-26', 241],
  ['095-2025-26', 233],
  ['096-2025-26', 241],
  ['097-2025-26', 241],
  ['098-2025-26', 246],
  ['099-2025-26', 241],
  ['100-2025-26', 241],
  ['101-2025-26', 241],
  ['102-2025-26', 246],
  ['103-2025-26', 246],
  ['104-2025-26', 241],
  ['105-2026-27', 246],
  ['106-2026-27', 241],
  ['107-2026-27', 241],
  ['108-2026-27', 241],
]

const defaultEwayBuyerDistances = [
  ['B001', 241],
  ['B002', 246],
  ['B003', 241],
  ['B004', 233],
  ['B005', 241],
]

const defaultEwayAmbiguousBuyerCodes = []

export {
  defaultBuyerShipToOptions,
  defaultEwayAmbiguousBuyerCodes,
  defaultEwayBuyerDistances,
  defaultEwayInvoiceDistances,
}
