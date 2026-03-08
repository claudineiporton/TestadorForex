import { useState, useEffect, useCallback, useRef } from 'react';
import { SYMBOLS, calculatePnL } from './config';
import { getHistoricalData, saveHistoricalData, getStoredDateRange } from './storage';

const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 30);
const defaultStartStr = defaultStart.toISOString().split('T')[0];
const defaultEndStr = new Date().toISOString().split('T')[0];

export const useForexEngine = (initialBalance = 0) => {
    const [balance, setBalance] = useState(initialBalance);
    const [equity, setEquity] = useState(initialBalance);
    const [positions, setPositions] = useState([]);
    const [history, setHistory] = useState([]);
    const [currentPrice, setCurrentPrice] = useState(null); // Bid price
    const [askPrice, setAskPrice] = useState(null); // Ask price
    const [candles, setCandles] = useState([]);
    const [activeSymbol, setActiveSymbol] = useState('EURUSD');
    const [isRunning, setIsRunning] = useState(false);
    const [speed, setSpeed] = useState(1); // 1x, 2x, etc.
    const [startDate, setStartDate] = useState(defaultStartStr);
    const [endDate, setEndDate] = useState(defaultEndStr);
    const [simulatedTime, setSimulatedTime] = useState(null);
    const [timeframe, setTimeframe] = useState(60); // In seconds (60 = 1 min)
    const [localDataRange, setLocalDataRange] = useState({ minTime: null, maxTime: null, count: 0 }); // <--- New state
    const dataTimeframeRef = useRef(60); // Stores the resolution of the downloaded data
    const prevStartDateRef = useRef(startDate);

    const priceInterval = useRef(null);

    const [isLoadingData, setIsLoadingData] = useState(false);
    const historicalDataRef = useRef([]); // Armazena todos os candles reais
    const currentIndexRef = useRef(0);    // Ponteiro de reprodução
    const lastKnownTimeRef = useRef(null); // Para sincronizar entre timeframes
    const positionsRef = useRef([]);      // TRACK POSITIONS SYNC FOR SIM LOOP

    const fetchLocalRangeInfo = useCallback(async (symbol) => {
        try {
            // M1 is the base resolution we import
            const range = await getStoredDateRange(symbol, 60);
            setLocalDataRange(range);
        } catch (error) {
            console.error("Failed to fetch local range info:", error);
            setLocalDataRange({ minTime: null, maxTime: null, count: 0 });
        }
    }, []);

    // Check local data range whenever activeSymbol changes
    useEffect(() => {
        fetchLocalRangeInfo(activeSymbol);
    }, [activeSymbol, fetchLocalRangeInfo]);

    // Fetch Real Historical Data from Yahoo Finance via Proxy
    useEffect(() => {
        let isCancelled = false;
        const fetchYahooData = async () => {
            setIsLoadingData(true);
            // Clear current view immediately to prevent timeframe mismatch crashes in the chart
            setCandles([]);
            historicalDataRef.current = [];

            // Track if startDate changed to reset playhead
            const prevStart = prevStartDateRef.current;
            prevStartDateRef.current = startDate;
            const didStartDateChange = prevStart !== startDate;

            // Preserve the current simulated time before reset, but IGNORE if user changed start date
            const syncTime = didStartDateChange ? null : lastKnownTimeRef.current;

            try {
                // Determine Yahoo interval format based on timeframe (seconds)
                let interval = '1m';
                const baseTimeframe = 60; // MT5 CSV is M1

                // Calculate UNIX timestamps
                let dStart = new Date(startDate);
                if (isNaN(dStart.getTime())) dStart = new Date(defaultStartStr);
                dStart.setHours(0, 0, 0, 0);

                let dEnd = endDate ? new Date(endDate) : new Date();
                if (isNaN(dEnd.getTime())) dEnd = new Date();
                dEnd.setHours(23, 59, 59, 0);

                // Add a 15-day buffer BEFORE the start date so the chart has history for indicators (like SMA 200)
                const dStartBuffer = new Date(dStart.getTime() - (15 * 24 * 60 * 60 * 1000));

                const period1 = Math.floor(dStartBuffer.getTime() / 1000);
                const period2 = Math.floor(dEnd.getTime() / 1000);
                const exactStartTime = Math.floor(dStart.getTime() / 1000);

                // --- 1. TRY LOCAL INDEXED DB FIRST ---
                const localData = await getHistoricalData(activeSymbol, baseTimeframe, period1, period2);
                let normalizedData = [];

                if (localData && localData.length > 0) {
                    console.log(`[Engine] Loaded ${localData.length} records from Local DB for ${activeSymbol}`);
                    dataTimeframeRef.current = baseTimeframe;

                    // Deduplicate and strictly sort the local data. 
                    // This fixes the blank chart bug if the user imported the CSV multiple times
                    // and caused duplicate timestamps (which crashes the Lightweight Charts library).
                    const uniqueMap = new Map();
                    for (const row of localData) {
                        uniqueMap.set(row.time, row);
                    }

                    normalizedData = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
                    console.log(`[Engine] After deduplication: ${normalizedData.length} unique candles`);
                } else {
                    // --- 2. FALLBACK TO YAHOO FINANCE ---
                    console.log(`[Engine] Local data not found. Falling back to Yahoo Finance for ${activeSymbol}`);

                    if (timeframe === 300) interval = '5m';
                    else if (timeframe === 900) interval = '15m';
                    else if (timeframe === 1800) interval = '30m';
                    else if (timeframe === 3600) interval = '1h';
                    else if (timeframe === 14400) interval = '1h';
                    else if (timeframe === 86400) interval = '1d';

                    // --- YAHOO FINANCE INTRADAY LIMITATION FIX ---
                    const now = new Date();
                    let yfStart = new Date(dStartBuffer);

                    if (interval === '1m') {
                        const maxPastDate = new Date();
                        maxPastDate.setDate(now.getDate() - 7);
                        if (yfStart < maxPastDate) {
                            console.warn("1m data limited to last 7 days. Clamping.");
                            yfStart = maxPastDate;
                        }
                    } else if (interval !== '1d') {
                        const maxPastDate = new Date();
                        maxPastDate.setDate(now.getDate() - 59);
                        if (yfStart < maxPastDate) {
                            console.warn("Intraday data limited to last 60 days. Clamping.");
                            yfStart = maxPastDate;
                        }
                    }

                    if (yfStart > dEnd) yfStart = new Date(dEnd.getTime() - (86400 * 1000 * 7));

                    const p1 = Math.floor(yfStart.getTime() / 1000);
                    const p2 = Math.floor(dEnd.getTime() / 1000);
                    const yfSymbol = `${activeSymbol.toUpperCase()}=X`;

                    const url = `/api/yahoo/v8/finance/chart/${yfSymbol}?period1=${p1}&period2=${p2}&interval=${interval}`;
                    const response = await fetch(url);
                    if (isCancelled) return;
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const json = await response.json();

                    const result = json.chart.result;
                    if (!result || !result[0].timestamp) {
                        alert(`Nenhum dado real encontrado para ${activeSymbol} neste período.`);
                        setIsLoadingData(false);
                        return;
                    }

                    const quote = result[0].indicators.quote[0];
                    const timestamps = result[0].timestamp;

                    // Map into Lightweight-charts format
                    let rawData = [];
                    for (let i = 0; i < timestamps.length; i++) {
                        if (quote.open[i] !== null && quote.close[i] !== null) {
                            rawData.push({
                                time: timestamps[i],
                                open: quote.open[i],
                                high: quote.high[i],
                                low: quote.low[i],
                                close: quote.close[i]
                            });
                        }
                    }

                    // --- DATA NORMALIZATION (Group & Fill Gaps) ---
                    const downloadTimeframeSeconds = interval.endsWith('m') ? parseInt(interval) * 60 :
                        interval.endsWith('h') ? parseInt(interval) * 3600 : 86400;
                    dataTimeframeRef.current = downloadTimeframeSeconds;

                    const normalizedMap = new Map();
                    rawData.forEach(c => {
                        const alignedTime = Math.floor(c.time / downloadTimeframeSeconds) * downloadTimeframeSeconds;
                        normalizedMap.set(alignedTime, c);
                    });

                    const sortedTimes = Array.from(normalizedMap.keys()).sort((a, b) => a - b);
                    if (sortedTimes.length > 0) {
                        sortedTimes.forEach(time => {
                            const candle = normalizedMap.get(time);
                            normalizedData.push({
                                ...candle,
                                time: time,
                                open: Number(candle.open.toFixed(5)),
                                high: Number(candle.high.toFixed(5)),
                                low: Number(candle.low.toFixed(5)),
                                close: Number(candle.close.toFixed(5))
                            });
                        });
                    }
                } // End Yahoo Fallback
                if (normalizedData.length === 0) {
                    setIsLoadingData(false);
                    return;
                }

                if (isCancelled) return;
                historicalDataRef.current = normalizedData;

                // --- TIMEFRAME SYNC LOGIC ---
                let startIdx = 0;
                if (syncTime) {
                    // Usually timeframe change: keep same time
                    let foundIndex = -1;
                    for (let i = normalizedData.length - 1; i >= 0; i--) {
                        if (normalizedData[i].time <= syncTime) {
                            foundIndex = i;
                            break;
                        }
                    }
                    if (foundIndex !== -1) startIdx = foundIndex;
                    else startIdx = Math.max(1, Math.floor(normalizedData.length * 0.1));
                } else {
                    // Start date changed or initial load: Find the exact start time in the data array
                    // Since we padded the data by 15 days, we want the playhead to start exactly
                    // at the StartDate chosen by the user
                    let foundIndex = -1;
                    for (let i = 0; i < normalizedData.length; i++) {
                        if (normalizedData[i].time >= exactStartTime) {
                            foundIndex = i;
                            break;
                        }
                    }

                    if (foundIndex !== -1) {
                        // If we matched near the very first candle, the requested start time was way before our data.
                        // For a good visual experience, we require at least an artificial buffer (e.g., 200 candles).
                        const minHistoryBuffer = Math.min(200, Math.floor(normalizedData.length * 0.5));
                        if (foundIndex < minHistoryBuffer) {
                            startIdx = minHistoryBuffer; // Artificially advance the start point so the chart has visual data
                        } else {
                            startIdx = foundIndex;
                        }
                    } else {
                        // Fallback if the requested date is missing or entirely in the future
                        startIdx = Math.max(1, Math.floor(normalizedData.length * 0.1));
                    }
                }

                currentIndexRef.current = startIdx;
                const visibleGranular = normalizedData.slice(0, startIdx + 1);

                // --- AGGREGATION FOR INITIAL STATE ---
                const initialAggregated = aggregateData(visibleGranular, timeframe);
                setCandles(initialAggregated);

                const lastGranular = visibleGranular[visibleGranular.length - 1];
                const spreadPoints = SYMBOLS[activeSymbol.toUpperCase()]?.spreadPoints || 10;
                const spreadVal = spreadPoints * (SYMBOLS[activeSymbol.toUpperCase()]?.tickSize || 0.00001);

                setCurrentPrice(lastGranular.close);
                setAskPrice(lastGranular.close + spreadVal);
                setSimulatedTime(lastGranular.time);
                lastKnownTimeRef.current = lastGranular.time;

            } catch (error) {
                console.error("Failed to fetch historical data:", error);
            } finally {
                setIsLoadingData(false);
            }
        };

        fetchYahooData();
        return () => { isCancelled = true; };
    }, [activeSymbol, startDate, endDate, timeframe]);

    // Helper: Aggregate granular data into larger timeframe candles
    const aggregateData = useCallback((granularData, targetTf) => {
        if (!granularData || granularData.length === 0) return [];
        const result = [];
        const groups = new Map();

        granularData.forEach(c => {
            const alignedTime = Math.floor(c.time / targetTf) * targetTf;
            if (!groups.has(alignedTime)) {
                groups.set(alignedTime, {
                    time: alignedTime,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close
                });
            } else {
                const g = groups.get(alignedTime);
                g.high = Math.max(g.high, c.high);
                g.low = Math.min(g.low, c.low);
                g.close = c.close;
            }
        });

        return Array.from(groups.values()).sort((a, b) => a.time - b.time);
    }, []);

    // Update Equity based on open positions
    useEffect(() => {
        const floatingPnL = positions.reduce((acc, pos) => {
            // Se estou comprado (BUY), fecho no preço BID (currentPrice).
            // Se estou vendido (SELL), fecho no preço ASK (askPrice).
            const closingPrice = pos.type === 'BUY' ? currentPrice : askPrice;
            if (closingPrice == null) return acc;
            return acc + calculatePnL(pos.openPrice, closingPrice, SYMBOLS[activeSymbol.toUpperCase()].lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);
        }, 0);
        setEquity(Number((balance + floatingPnL).toFixed(2)));
    }, [currentPrice, askPrice, positions, balance, activeSymbol]);

    // Playback Logic (Injecting Real Historical Data Frame-by-Frame)
    const checkTakeProfitStopLoss = useCallback((bidPrice, askPrice) => {
        if (bidPrice == null || askPrice == null) return;

        const closed = [];
        const remaining = [];

        // USE REF FOR SYNC CHECK
        positionsRef.current.forEach(pos => {
            if (pos.symbol.toUpperCase() !== activeSymbol.toUpperCase()) {
                remaining.push(pos);
                return;
            }

            let shouldClose = false;
            let closePriceHit = null;

            const symbolConfig = SYMBOLS[activeSymbol.toUpperCase()];
            if (!symbolConfig) {
                remaining.push(pos);
                return;
            }

            // BUY positions close at BID price
            // SELL positions close at ASK price
            const checkPrice = pos.type === 'BUY' ? bidPrice : askPrice;

            if (pos.type === 'BUY') {
                if (pos.tp && Number(pos.tp) > 0 && checkPrice >= Number(pos.tp)) { shouldClose = true; closePriceHit = pos.tp; }
                if (pos.sl && Number(pos.sl) > 0 && checkPrice <= Number(pos.sl)) { shouldClose = true; closePriceHit = pos.sl; }
            } else {
                if (pos.tp && Number(pos.tp) > 0 && checkPrice <= Number(pos.tp)) { shouldClose = true; closePriceHit = pos.tp; }
                if (pos.sl && Number(pos.sl) > 0 && checkPrice >= Number(pos.sl)) { shouldClose = true; closePriceHit = pos.sl; }
            }

            if (shouldClose) {
                const type = (pos.type === 'BUY' ? (checkPrice >= Number(pos.tp) ? 'TP' : 'SL') : (checkPrice <= Number(pos.tp) ? 'TP' : 'SL'));
                console.log(`[Engine] Position ${pos.id} (${pos.type}) HIT ${type} @ ${checkPrice}. Target was ${closePriceHit}`);

                // Em simulação ideal, executamos exatamente no preço do limite (slippage zero).
                const executedPrice = closePriceHit || checkPrice;
                const pnl = calculatePnL(pos.openPrice, executedPrice, symbolConfig.lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);

                closed.push({ ...pos, closePrice: executedPrice, pnl, closeTime: new Date().toLocaleTimeString() });
            } else {
                remaining.push(pos);
            }
        });

        if (closed.length > 0) {
            const totalClosedPnL = closed.reduce((acc, p) => acc + p.pnl, 0);
            setBalance(b => Number((b + totalClosedPnL).toFixed(2)));
            setHistory(h => [...closed, ...h]);

            // Sync both state and ref
            positionsRef.current = remaining;
            setPositions(remaining);
        }
    }, [activeSymbol]);

    const tickPrice = useCallback(() => {
        if (!isRunning || !historicalDataRef.current.length) return;

        const nextIndex = currentIndexRef.current + 1;
        if (nextIndex >= historicalDataRef.current.length) {
            setIsRunning(false);
            return;
        }

        const latestGranular = historicalDataRef.current[nextIndex];
        if (!latestGranular) return;

        // Check against endDate to stop the simulation
        if (endDate) {
            // we parse endDate and set it to 23:59:59 of that day local time to allow the simulation to run through that day.
            const endD = new Date(endDate);
            endD.setHours(23, 59, 59, 999);
            const endTimeStamp = Math.floor(endD.getTime() / 1000);

            if (latestGranular.time > endTimeStamp) {
                setIsRunning(false);
                alert("O período definido para o teste foi atingido.");
                return;
            }
        }

        // Batch state updates
        const spreadPoints = SYMBOLS[activeSymbol.toUpperCase()]?.spreadPoints || 10;
        const spreadVal = spreadPoints * (SYMBOLS[activeSymbol.toUpperCase()]?.tickSize || 0.00001);
        const newBid = latestGranular.close;
        const newAsk = newBid + spreadVal;

        setCurrentPrice(newBid);
        setAskPrice(newAsk);
        setSimulatedTime(latestGranular.time);
        lastKnownTimeRef.current = latestGranular.time;

        // Use Close price for TP/SL check to avoid "invisible wick" stop-outs
        // that confuse the user when setting levels during a ticking candle.
        checkTakeProfitStopLoss(newBid, newAsk);

        // Update Candles with Aggregation
        setCandles(prev => {
            const alignedTime = Math.floor(latestGranular.time / timeframe) * timeframe;
            const updated = [...prev];

            if (updated.length > 0 && updated[updated.length - 1].time === alignedTime) {
                // Update the last "forming" candle
                const last = { ...updated[updated.length - 1] };
                last.high = Math.max(last.high, latestGranular.high);
                last.low = Math.min(last.low, latestGranular.low);
                last.close = latestGranular.close;
                updated[updated.length - 1] = last;
                return updated;
            } else {
                // O(1) append instead of O(N log N) re-aggregation of 100,000+ items
                updated.push({
                    time: alignedTime,
                    open: latestGranular.open,
                    high: latestGranular.high,
                    low: latestGranular.low,
                    close: latestGranular.close
                });
                return updated;
            }
        });

        currentIndexRef.current = nextIndex;
    }, [isRunning, activeSymbol, timeframe, aggregateData, checkTakeProfitStopLoss]); // Now reliable because it doesn't close over stale check func

    useEffect(() => {
        if (isRunning) {
            const timeframeFactor = Math.pow(timeframe / 60, 0.3);
            const realTickInterval = Math.max(40, (1000 * timeframeFactor) / speed);
            priceInterval.current = setInterval(tickPrice, realTickInterval);
        } else {
            clearInterval(priceInterval.current);
        }
        return () => clearInterval(priceInterval.current);
    }, [isRunning, tickPrice, speed, timeframe]);

    const openPosition = (type, lots, sl = null, tp = null) => {
        if (balance <= 0) {
            alert("Saldo insuficiente! Por favor, realize um novo depósito.");
            return;
        }

        // Realistic entry: Buy at Ask, Sell at Bid
        const entryPrice = type === 'BUY' ? askPrice : currentPrice;

        const newPosition = {
            id: Date.now(),
            type,
            lots,
            openPrice: entryPrice,
            sl: sl ? Number(sl) : null,
            tp: tp ? Number(tp) : null,
            openTime: new Date().toLocaleTimeString(),
            symbol: activeSymbol
        };

        const updated = [...positionsRef.current, newPosition];
        positionsRef.current = updated;
        setPositions(updated);
    };

    const closePosition = (id) => {
        const currentPositions = positionsRef.current;
        const pos = currentPositions.find(p => p.id === id);
        if (!pos) return;

        // Realistic close: close Buy at Bid, close Sell at Ask
        const closingPrice = pos.type === 'BUY' ? currentPrice : askPrice;
        const pnl = calculatePnL(pos.openPrice, closingPrice, SYMBOLS[activeSymbol.toUpperCase()].lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);

        setBalance(prev => Number((prev + pnl).toFixed(2)));
        setHistory(prev => [{ ...pos, closePrice: closingPrice, pnl, closeTime: new Date().toLocaleTimeString() }, ...prev]);

        const remaining = currentPositions.filter(p => p.id !== id);
        positionsRef.current = remaining;
        setPositions(remaining);
    };

    const updatePosition = (id, updates) => {
        console.log(`[Engine] Updating position ${id}:`, updates);
        const updated = positionsRef.current.map(pos =>
            pos.id === id ? { ...pos, ...updates } : pos
        );
        positionsRef.current = updated;
        setPositions(updated);
    };

    const deposit = (amount) => {
        setBalance(prev => prev + amount);
    };

    /**
     * Parses an MT5 History Export CSV file and saves it to local IndexedDB.
     * Expected format: <DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>
     * @param {File} file 
     * @param {string} symbol
     */
    const importCSVData = (file, symbol) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const text = e.target.result;
                    const lines = text.split('\n');
                    const parsedCandles = [];

                    // Base MT5 exports use 1-minute (usually)
                    const timeframe = 60;

                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;

                        // MT5 CSVs usually use tabs or commas depending on exact export settings.
                        // Let's handle both.
                        const separator = line.includes('\t') ? '\t' : ',';
                        const parts = line.split(separator);

                        // Minimum valid columns: Date, Time, Open, High, Low, Close
                        if (parts.length >= 6) {
                            // Standard MT5 is YYYY.MM.DD HH:MM
                            // We construct a strict ISO string YYYY-MM-DDTHH:mm:00Z
                            const rawDate = parts[0].replace(/\./g, '-').replace(/\//g, '-');
                            const timeStr = parts[1].length === 5 ? `${parts[1]}:00` : parts[1];

                            const o = parseFloat(parts[2]);
                            const h = parseFloat(parts[3]);
                            const l = parseFloat(parts[4]);
                            const c = parseFloat(parts[5]);
                            const v = parts.length >= 7 ? parseFloat(parts[6]) : 0;

                            const datetimeStr = `${rawDate}T${timeStr}Z`;
                            const dateObj = new Date(datetimeStr);

                            if (!isNaN(dateObj.getTime()) && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c)) {
                                parsedCandles.push({
                                    time: Math.floor(dateObj.getTime() / 1000), // UNIX seconds
                                    open: o,
                                    high: h,
                                    low: l,
                                    close: c,
                                    volume: v
                                });
                            }
                        }
                    }

                    if (parsedCandles.length > 0) {
                        await saveHistoricalData(symbol, timeframe, parsedCandles);

                        // Update local data range immediately
                        await fetchLocalRangeInfo(symbol);

                        // Force a re-fetch visually if we are currently looking at this symbol
                        if (symbol.toUpperCase() === activeSymbol.toUpperCase()) {
                            // Quick toggle to trigger useEffect
                            setStartDate(prev => prev);
                        }

                        resolve({ count: parsedCandles.length });
                    } else {
                        reject(new Error("Nenhum dado válido encontrado no arquivo."));
                    }
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
            reader.readAsText(file);
        });
    };

    return {
        balance,
        equity,
        positions,
        history,
        currentPrice, // Bid
        askPrice,     // Ask
        candles,
        activeSymbol,
        setActiveSymbol,
        isRunning,
        setIsRunning,
        speed,
        setSpeed,
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        simulatedTime,
        timeframe,
        setTimeframe,
        openPosition,
        updatePosition,
        closePosition,
        deposit,
        setBalance,
        importCSVData,
        localDataRange // <--- export the local data range to App.jsx
    };
};
