// Flatten Airtable records into the shapes the front end uses.
function auction(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    upc: f.UPC || '',
    name: f['Product Name'] || '',
    brand: f.Brand || '',
    cost: f.Cost ?? null,
    image: f['Image URL'] || '',
    scannedMs: f['Scanned Ms'] || 0,
    streamDate: f['Stream Date'] || '',
    status: f['Match Status'] || 'Open',
    unknown: !!f.Unknown,
    orderId: f['Order ID'] || '',
    price: f['Sale Price'] ?? null,
    buyer: f.Buyer || '',
    orderStatus: f['Order Status'] || '',
    units: f.Units || 1,
    saleNumber: f['Sale Number'] || null,
    streamId: f['Stream ID'] || '',
    bundleItems: (() => { try { return f['Bundle Items'] ? JSON.parse(f['Bundle Items']) : null; } catch (e) { return null; } })(),
  };
}

function product(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    upc: f.UPC || '',
    name: f.Name || '',
    brand: f.Brand || '',
    category: f.Category || '',
    cost: f.Cost ?? null,
    qty: f['Qty On Hand'] ?? 0,
    image: f['Image URL'] || '',
    sku: f.SKU || '',
    startPrice: f['Start Price'] ?? null,
    isBundle: !!f['Is Bundle'],
    contents: f['Bundle Contents'] || '',
    components: f.Components || [],
  };
}

function order(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    orderId: f['Order ID'] || '',
    createdMs: f['Created Ms'] || 0,
    price: f.Price ?? null,
    status: f['Order Status'] || '',
    buyer: f.Buyer || '',
    match: f['Match Status'] || '',
    note: f.Note || '',
    auctionRec: f['Auction Rec'] || '',
  };
}

module.exports = { auction, product, order };
