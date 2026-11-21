/**
 * ShipFusion + manual fulfillment resolution for the command center API.
 *
 * Precedence (documented in docs/DATA_SOURCES.md):
 * 1. ShipFusion shipment charges are primary for covered categories
 *    (pickPack, shipping, packaging, insurance, other) on dates the API returns.
 * 2. Manual invoices whose label indicates storage (e.g. contains "storage")
 *    are ALWAYS added as `storage` — storage is typically billed month-end and
 *    may not appear in the shipment invoice API.
 * 3. Non-storage manual invoices are used only for calendar days in the
 *    requested range that have NO ShipFusion coverage (API missing/failed, or
 *    period before ShipFusion cutover). Their prorated daily amount lands in
 *    `other` so we do not double-count pick/pack/shipping already in the API.
 * 4. If the API returns nothing for the whole range (no key / error), fall back
 *    to full manual prorating (legacy Nice Commerce behaviour).
 */

import type { FulfillmentInvoiceRow } from "./db"
import { fetchShipFusionDailyCosts } from "./shipfusion"
import {
  mergeFulfillmentCosts,
  isStorageManualInvoice,
  type MergedFulfillment,
  type FulfillmentSource,
} from "./fulfillment-merge"

export type { MergedFulfillment, FulfillmentSource }
export { mergeFulfillmentCosts, isStorageManualInvoice }

/** Convenience: fetch ShipFusion + merge with manuals for a date range. */
export async function resolveFulfillmentForRange(
  dateStart: string,
  dateEnd: string,
  manualInvoices: FulfillmentInvoiceRow[]
): Promise<MergedFulfillment> {
  const sf = await fetchShipFusionDailyCosts(dateStart, dateEnd)
  return mergeFulfillmentCosts({
    dateStart,
    dateEnd,
    shipfusionDaily: sf.daily,
    shipfusionError: sf.error,
    shipfusionAuthMode: sf.authMode,
    shipfusionInvoiceCount: sf.invoiceCount,
    shipfusionTransactionCount: sf.transactionCount,
    manualInvoices,
  })
}
