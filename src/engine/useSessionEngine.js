import { useState, useEffect, useCallback, useRef } from 'react';
import { SYMBOLS, calculatePnL } from './config';
import { getHistoricalData, getStoredDateRange } from './storage';

export const useSessionEngine = (sessionConfig, onSaveSession) => {
    const {
        id,
        initialBalance,
        currentBalance: loadedBalance,
        selectedPairs,
        startDate,
        endDate,
        positions: loadedPositions,
        history: loadedHistory,
        timeframe: loadedTimeframe
    } = sessionConfig;

    const [balance, setBalance] = useState(loadedBalance ?? initialBalance);
    const [equity, setEquity] = useState(balance);
    const [positions, setPositions] = useState(loadedPositions || []);
    const [history, setHistory] = useState(loadedHistory || []);

    // Maps for multi-pair data
    // bidPrices[symbol] = number
    const [bidPrices, setBidPrices] = useState({});
    const [askPrices, setAskPrices] = useState({});

    // candles[symbol] = Array of lightweight chart candle objects
    const [candlesMap, setCandlesMap] = useState({});

    const [activeSymbol, setActiveSymbol] = useState(selectedPairs[0]);
    const [isRunning, setIsRunning] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [timeframe, setTimeframe] = useState(loadedTimeframe || 60);
    const [simulatedTime, setSimulatedTime] = useState(null);
    const [isLoadingData, setIsLoadingData] = useState(false);

    // Internal Refs for the loop
    const historicalDataMapRef = useRef({}); // { 'EURUSD': [all 1m candles], ... }
    const currentIndexRef = useRef(0);
    const positionsRef = useRef(positions);
    const priceInterval = useRef(null);

    // Sync ref when state changes
    useEffect(() => { positionsRef.current = positions; }, [positions]);

    // Save session continuously when important things change
    useEffect(() => {
        if (onSaveSession) {
            onSaveSession({
                ...sessionConfig,
                currentBalance: balance,
                positions,
                history,
                timeframe,
                // Do we save simulatedTime? Yes, to resume exactly where we left off.
                // We'll add this later if needed.
            });
        }
    }, [balance, positions, history, timeframe]);

    // Fetch data for all selected pairs
    useEffect(() => {
        let isCancelled = false;
        const fetchAllData = async () => {
            setIsLoadingData(true);
            setCandlesMap({});
            historicalDataMapRef.current = {};

            let dStart = new Date(startDate);
            dStart.setHours(0, 0, 0, 0);
            let dEnd = new Date(endDate);
            dEnd.setHours(23, 59, 59, 0);

            const exactStartTime = Math.floor(dStart.getTime() / 1000);

            try {
                const newDataMap = {};
                let maxCandlesLength = 0;

                for (const symbol of selectedPairs) {
                    const localData = await getHistoricalData(symbol, 60, 0, Infinity); // Fetch all to filter manually, or bounded
                    if (localData && localData.length > 0) {
                        const uniqueMap = new Map();
                        for (const row of localData) {
                            if (row.time <= Math.floor(dEnd.getTime() / 1000)) { // Don't load future beyond end date
                                uniqueMap.set(row.time, row);
                            }
                        }
                        const normalizedData = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
                        newDataMap[symbol] = normalizedData;
                        maxCandlesLength = Math.max(maxCandlesLength, normalizedData.length);
                    } else {
                        console.warn(`No offline data for ${symbol}. You must import CSV first for multi-pair sync.`);
                        newDataMap[symbol] = [];
                    }
                }

                if (isCancelled) return;

                historicalDataMapRef.current = newDataMap;

                // Time Sync: Find a unified start index based on physical timestamp
                // The arrays might not be perfectly aligned.
                // For simplicity, we align the pointers based on time.
                // Let's create a combined timeline, or just use EURUSD as master clock.

                let masterSymbol = selectedPairs[0];
                let masterData = newDataMap[masterSymbol];

                if (!masterData || masterData.length === 0) {
                    setIsLoadingData(false);
                    return;
                }

                let startIndex = 0;
                for (let i = 0; i < masterData.length; i++) {
                    if (masterData[i].time >= exactStartTime) {
                        startIndex = i;
                        break;
                    }
                }

                currentIndexRef.current = startIndex;

                // Initialize initial visible candles for all symbols
                const initialCandles = {};
                const initialBids = {};
                const initialAsks = {};

                for (const sym of selectedPairs) {
                    const targetTime = masterData[startIndex].time;
                    const symData = newDataMap[sym];

                    if (symData && symData.length > 0) {
                        // Find how many candles in this sym match up to targetTime
                        let symEndIdx = 0;
                        for (let j = 0; j < symData.length; j++) {
                            if (symData[j].time <= targetTime) symEndIdx = j;
                            else break;
                        }

                        const visible = symData.slice(0, symEndIdx + 1);
                        initialCandles[sym] = aggregateData(visible, timeframe);

                        const lastCandle = visible[visible.length - 1];
                        if (lastCandle) {
                            const spreadPoints = SYMBOLS[sym.toUpperCase()]?.spreadPoints || 10;
                            const spreadVal = spreadPoints * (SYMBOLS[sym.toUpperCase()]?.tickSize || 0.00001);
                            initialBids[sym] = lastCandle.close;
                            initialAsks[sym] = lastCandle.close + spreadVal;
                        }
                    } else {
                        initialCandles[sym] = [];
                    }
                }

                setCandlesMap(initialCandles);
                setBidPrices(initialBids);
                setAskPrices(initialAsks);
                setSimulatedTime(masterData[startIndex].time);

            } catch (e) {
                console.error("Failed to fetch session data", e);
            } finally {
                setIsLoadingData(false);
            }
        };
        fetchAllData();
        return () => { isCancelled = true; };
    }, [selectedPairs, startDate, endDate, timeframe]);

    const aggregateData = useCallback((granularData, targetTf) => {
        if (!granularData || granularData.length === 0) return [];
        const groups = new Map();
        granularData.forEach(c => {
            const alignedTime = Math.floor(c.time / targetTf) * targetTf;
            if (!groups.has(alignedTime)) {
                groups.set(alignedTime, { time: alignedTime, open: c.open, high: c.high, low: c.low, close: c.close });
            } else {
                const g = groups.get(alignedTime);
                g.high = Math.max(g.high, c.high);
                g.low = Math.min(g.low, c.low);
                g.close = c.close;
            }
        });
        return Array.from(groups.values()).sort((a, b) => a.time - b.time);
    }, []);

    // ... To be continued with Tick Price logically synced across pairs
    // ... Implement Equity, OpenPosition similar to useForexEngine

    // Update Equity
    useEffect(() => {
        const floatingPnL = positions.reduce((acc, pos) => {
            const closingBid = bidPrices[pos.symbol];
            const closingAsk = askPrices[pos.symbol];
            if (closingBid == null || closingAsk == null) return acc;
            const closingPrice = pos.type === 'BUY' ? closingBid : closingAsk;
            return acc + calculatePnL(pos.openPrice, closingPrice, SYMBOLS[pos.symbol].lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);
        }, 0);
        setEquity(Number((balance + floatingPnL).toFixed(2)));
    }, [bidPrices, askPrices, positions, balance]);

    const tickSession = useCallback(() => {
        if (!isRunning) return;

        const masterSymbol = selectedPairs[0];
        const masterData = historicalDataMapRef.current[masterSymbol];
        if (!masterData) return;

        const nextIndex = currentIndexRef.current + 1;
        if (nextIndex >= masterData.length) {
            setIsRunning(false);
            alert("Fim dos dados do histórico da sessão.");
            return;
        }

        const targetTime = masterData[nextIndex].time;

        if (endDate) {
            const endD = new Date(endDate);
            endD.setHours(23, 59, 59, 999);
            if (targetTime > Math.floor(endD.getTime() / 1000)) {
                setIsRunning(false);
                alert("O período definido para a sessão foi atingido.");
                return;
            }
        }

        setSimulatedTime(targetTime);
        currentIndexRef.current = nextIndex;

        const newBids = { ...bidPrices };
        const newAsks = { ...askPrices };

        const checkPosQueue = []; // For SL/TP check

        setCandlesMap(prevMap => {
            const newMap = { ...prevMap };

            for (const sym of selectedPairs) {
                const symData = historicalDataMapRef.current[sym];
                if (!symData) continue;

                // Binary search or linear search forward to find the candle corresponding to targetTime
                // Since M1 timeframes are generally 60s gaps, we just look for exact match or next closest
                // For performance, we can just use the targetTime to find the right chunk.
                // Actual implementation for simulation: we just find the last candle <= targetTime

                // A better approach for simulation: binary search the exact index for each pair's time
                let left = 0; let right = symData.length - 1; let foundIdx = -1;
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    if (symData[mid].time === targetTime) { foundIdx = mid; break; }
                    else if (symData[mid].time < targetTime) { foundIdx = mid; left = mid + 1; }
                    else right = mid - 1;
                }

                if (foundIdx !== -1) {
                    const latest = symData[foundIdx];
                    const spreadPoints = SYMBOLS[sym.toUpperCase()]?.spreadPoints || 10;
                    const spreadVal = spreadPoints * (SYMBOLS[sym.toUpperCase()]?.tickSize || 0.00001);
                    newBids[sym] = latest.close;
                    newAsks[sym] = latest.close + spreadVal;

                    checkPosQueue.push({ sym, bid: newBids[sym], ask: newAsks[sym] });

                    // Update candles map
                    const alignedTime = Math.floor(latest.time / timeframe) * timeframe;
                    const currentArr = newMap[sym] || [];
                    const updatedArr = [...currentArr];

                    if (updatedArr.length > 0 && updatedArr[updatedArr.length - 1].time === alignedTime) {
                        const last = { ...updatedArr[updatedArr.length - 1] };
                        last.high = Math.max(last.high, latest.high);
                        last.low = Math.min(last.low, latest.low);
                        last.close = latest.close;
                        updatedArr[updatedArr.length - 1] = last;
                    } else {
                        updatedArr.push({
                            time: alignedTime,
                            open: latest.open,
                            high: latest.high,
                            low: latest.low,
                            close: latest.close
                        });
                    }
                    newMap[sym] = updatedArr;
                }
            }
            return newMap;
        });

        setBidPrices(newBids);
        setAskPrices(newAsks);

        // Em um useEffect ou na continuação da func, checkamos os TP/SL
        // Como o checkTakeProfitStopLoss depende do state, vamos integrar direto no logic de update
        let closedPnL = 0;
        const closed = [];
        const remaining = [];

        positionsRef.current.forEach(pos => {
            const symPrices = checkPosQueue.find(q => q.sym === pos.symbol);
            if (!symPrices) {
                remaining.push(pos);
                return;
            }

            const { bid: checkBid, ask: checkAsk } = symPrices;
            let shouldClose = false;
            let closePriceHit = null;
            const checkPrice = pos.type === 'BUY' ? checkBid : checkAsk;

            if (pos.type === 'BUY') {
                if (pos.tp && checkPrice >= pos.tp) { shouldClose = true; closePriceHit = pos.tp; }
                if (pos.sl && checkPrice <= pos.sl) { shouldClose = true; closePriceHit = pos.sl; }
            } else {
                if (pos.tp && checkPrice <= pos.tp) { shouldClose = true; closePriceHit = pos.tp; }
                if (pos.sl && checkPrice >= pos.sl) { shouldClose = true; closePriceHit = pos.sl; }
            }

            if (shouldClose) {
                const executedPrice = closePriceHit || checkPrice;
                const pnl = calculatePnL(pos.openPrice, executedPrice, SYMBOLS[pos.symbol].lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);
                closedPnL += pnl;
                closed.push({ ...pos, closePrice: executedPrice, pnl, closeTime: new Date().toLocaleTimeString() });
            } else {
                remaining.push(pos);
            }
        });

        if (closed.length > 0) {
            setBalance(b => Number((b + closedPnL).toFixed(2)));
            setHistory(h => [...closed, ...h]);
            setPositions(remaining);
        }

    }, [isRunning, endDate, timeframe, selectedPairs, bidPrices, askPrices]);

    useEffect(() => {
        if (isRunning) {
            const timeframeFactor = Math.pow(timeframe / 60, 0.3);
            const realTickInterval = Math.max(40, (1000 * timeframeFactor) / speed);
            priceInterval.current = setInterval(tickSession, realTickInterval);
        } else {
            clearInterval(priceInterval.current);
        }
        return () => clearInterval(priceInterval.current);
    }, [isRunning, tickSession, speed, timeframe]);

    const openPosition = (type, lots, sl = null, tp = null, symbol = activeSymbol) => {
        if (balance <= 0) return;
        const entryPrice = type === 'BUY' ? askPrices[symbol] : bidPrices[symbol];
        if (!entryPrice) return;

        const newPosition = {
            id: Date.now(),
            type,
            lots,
            openPrice: entryPrice,
            sl: sl ? Number(sl) : null,
            tp: tp ? Number(tp) : null,
            openTime: new Date().toLocaleTimeString(),
            symbol
        };
        setPositions([...positionsRef.current, newPosition]);
    };

    const closePosition = (id) => {
        const pos = positionsRef.current.find(p => p.id === id);
        if (!pos) return;

        const closingPrice = pos.type === 'BUY' ? bidPrices[pos.symbol] : askPrices[pos.symbol];
        const pnl = calculatePnL(pos.openPrice, closingPrice, SYMBOLS[pos.symbol].lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);

        setBalance(prev => Number((prev + pnl).toFixed(2)));
        setHistory(prev => [{ ...pos, closePrice: closingPrice, pnl, closeTime: new Date().toLocaleTimeString() }, ...prev]);
        setPositions(positionsRef.current.filter(p => p.id !== id));
    };

    const updatePosition = (id, updates) => {
        setPositions(positionsRef.current.map(pos => pos.id === id ? { ...pos, ...updates } : pos));
    };

    return {
        balance, setBalance,
        equity,
        positions,
        history,
        bidPrices,
        askPrices,
        candlesMap,
        simulatedTime,
        activeSymbol, setActiveSymbol,
        isRunning, setIsRunning,
        speed, setSpeed,
        timeframe, setTimeframe,
        openPosition, closePosition, updatePosition,
        isLoadingData
    };
};
