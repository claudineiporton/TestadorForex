export const SYMBOLS = {
    EURUSD: {
        name: 'EUR/USD',
        digits: 5,
        pipSize: 0.0001,
        tickSize: 0.00001,
        lotSize: 100000,
        initialPrice: 1.08500,
        spreadPoints: 12
    },
    USDJPY: {
        name: 'USD/JPY',
        digits: 3,
        pipSize: 0.01,
        tickSize: 0.001,
        lotSize: 100000,
        initialPrice: 156.400,
        spreadPoints: 15
    },
    GBPUSD: {
        name: 'GBP/USD',
        digits: 5,
        pipSize: 0.0001,
        tickSize: 0.00001,
        lotSize: 100000,
        initialPrice: 1.27200,
        spreadPoints: 15
    }
};

export const calculatePnL = (openPrice, currentPrice, lotSize, quantity, direction, symbol) => {
    // PnL calculation simplified for pairs where USD is quote or base
    // For majors like EURUSD: PnL = (Current - Open) * contractSize * lots
    let diff = (currentPrice - openPrice) * direction;

    // Basic formula for USD quote pairs (EURUSD, GBPUSD, etc)
    // If USD is NOT the quote currency (like USDJPY), the calculation is slightly different
    // but for the simulator we will calculate everything in "points/pips value"

    const profit = diff * lotSize * quantity;
    return Number(profit.toFixed(2));
};
