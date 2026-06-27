function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function findTradePointIndex(sortedDates, tradeDate) {
  if (!tradeDate || !sortedDates.length) return -1;
  return sortedDates.findIndex((date) => date >= tradeDate);
}

export function buildFundTrendTransactions(transactions, holding) {
  const rows = Array.isArray(transactions) ? transactions.filter(Boolean) : [];
  const firstPurchaseDate = normalizeDate(holding?.firstPurchaseDate);

  if (!firstPurchaseDate) return rows;

  const hasBuyOnFirstDate = rows.some((trade) => trade?.type === 'buy' && normalizeDate(trade?.date) === firstPurchaseDate);
  if (hasBuyOnFirstDate) return rows;

  return [{ type: 'buy', date: firstPurchaseDate, isFirstPurchase: true }, ...rows];
}

export function buildTradeMarkerPoints(data, percentageData, transactions) {
  const rows = Array.isArray(data) ? data : [];
  const values = Array.isArray(percentageData) ? percentageData : [];
  const sortedDates = rows.map((row) => normalizeDate(row?.date));
  const buyPoints = new Array(rows.length).fill(null);
  const sellPoints = new Array(rows.length).fill(null);

  if (!rows.length || !Array.isArray(transactions)) {
    return { buyPoints, sellPoints };
  }

  transactions.forEach((trade) => {
    const date = normalizeDate(trade?.date);
    const idx = findTradePointIndex(sortedDates, date);
    if (idx < 0) return;

    const value = values[idx];
    if (typeof value !== 'number' || !Number.isFinite(value)) return;

    if (trade?.type === 'buy') {
      buyPoints[idx] = value;
    } else if (trade?.type === 'sell') {
      sellPoints[idx] = value;
    }
  });

  return { buyPoints, sellPoints };
}
