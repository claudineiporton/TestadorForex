import { useState, useEffect, useCallback, useRef } from 'react';
import { SYMBOLS, calculatePnL } from './config';
import { getHistoricalData, getStoredDateRange } from './storage';

export const useSessionEngine = (sessionConfig, onSaveSession) => {
    const {
        id,
        initialBalance,
        currentBalance: loadedBalance,
        selectedPairs: initialSelectedPairs,
        startDate,
        endDate,
        positions: loadedPositions,
        history: loadedHistory,
        timeframe: loadedTimeframe,
        lastSimulatedTime,
        drawingsMap: loadedDrawingsMap
    } = sessionConfig;

    const [selectedPairs, setSelectedPairs] = useState(initialSelectedPairs || []);

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
    const [drawingsMap, setDrawingsMap] = useState(loadedDrawingsMap || {});

    const [activeSymbol, setActiveSymbol] = useState(selectedPairs[0]);
    const [isRunning, setIsRunning] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [timeframe, setTimeframe] = useState(loadedTimeframe || 60);
    const [simulatedTime, setSimulatedTime] = useState(lastSimulatedTime || null); // Initialized from persistence
    const [isLoadingData, setIsLoadingData] = useState(false);

    const historicalDataMapRef = useRef({});
    const currentIndexRef = useRef(0);
    const positionsRef = useRef(positions);
    const historyRef = useRef(history);
    const bidPricesRef = useRef(bidPrices);
    const askPricesRef = useRef(askPrices);
    const priceInterval = useRef(null);
    const sessionConfigRef = useRef(sessionConfig);

    // Update ref to current sessionConfig
    useEffect(() => {
        sessionConfigRef.current = sessionConfig;
    }, [sessionConfig]);


    // Sync refs when state changes
    useEffect(() => { positionsRef.current = positions; }, [positions]);
    useEffect(() => { historyRef.current = history; }, [history]);
    useEffect(() => { bidPricesRef.current = bidPrices; }, [bidPrices]);
    useEffect(() => { askPricesRef.current = askPrices; }, [askPrices]);

    // Save session continuously when important things change
    useEffect(() => {
        if (onSaveSession) {
            onSaveSession({
                ...sessionConfig,
                currentBalance: balance,
                positions,
                history,
                timeframe,
                lastSimulatedTime: simulatedTime,
                drawingsMap,
                selectedPairs,
            });
        }
    }, [balance, positions, history, timeframe, simulatedTime, drawingsMap, selectedPairs]);

    // Fetch data for all selected pairs
    useEffect(() => {
        let isCancelled = false;

        const {
            initialBalance: resetBalance,
            currentBalance: resetCurrentBalance,
            positions: resetPositions,
            history: resetHistory,
            lastSimulatedTime: resetSimulatedTime,
            drawingsMap: resetDrawingsMap
        } = sessionConfig;

        // Reset immediate display state for the new session
        setBalance(resetCurrentBalance ?? resetBalance);
        setEquity(resetCurrentBalance ?? resetBalance);
        setPositions(resetPositions || []);
        setHistory(resetHistory || []);
        setSimulatedTime(resetSimulatedTime || null);
        setBidPrices({});
        setAskPrices({});
        setCandlesMap({});
        setDrawingsMap(resetDrawingsMap || {});
        setSelectedPairs(initialSelectedPairs || []);
        setActiveSymbol(initialSelectedPairs[0]);
        const wasRunningBefore = isRunning;
        currentIndexRef.current = 0;
        // Don't stop the simulation if it was running; we'll resume it after loading

        const fetchAllData = async () => {
            setIsLoadingData(true);
            historicalDataMapRef.current = {};

            let dStart = new Date(startDate);
            dStart.setHours(0, 0, 0, 0);
            let dEnd = new Date(endDate);
            dEnd.setHours(23, 59, 59, 0);

            const exactStartTime = Math.floor(dStart.getTime() / 1000);

            try {
                const newDataMap = {};
                for (const symbol of selectedPairs) {
                    const localData = await getHistoricalData(symbol, 60, 0, Infinity);
                    if (localData && localData.length > 0) {
                        const uniqueMap = new Map();
                        for (const row of localData) {
                            if (row.time <= Math.floor(dEnd.getTime() / 1000)) {
                                uniqueMap.set(row.time, row);
                            }
                        }
                        newDataMap[symbol] = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
                    } else {
                        console.warn(`No data for ${symbol}`);
                        newDataMap[symbol] = [];
                    }
                }

                if (isCancelled) return;
                historicalDataMapRef.current = newDataMap;

                let masterSymbol = selectedPairs[0];
                let masterData = newDataMap[masterSymbol];
                if (!masterData || masterData.length === 0) {
                    setIsLoadingData(false);
                    return;
                }

                let syncTime = resetSimulatedTime;
                let startIndex = 0;

                if (syncTime) {
                    for (let i = masterData.length - 1; i >= 0; i--) {
                        if (masterData[i].time <= syncTime) {
                            startIndex = i;
                            break;
                        }
                    }
                } else {
                    for (let i = 0; i < masterData.length; i++) {
                        if (masterData[i].time >= exactStartTime) {
                            startIndex = i;
                            break;
                        }
                    }
                }

                currentIndexRef.current = startIndex;
                const finalSimTime = masterData[startIndex].time;
                setSimulatedTime(finalSimTime);

                const initialCandles = {};
                const initialBids = {};
                const initialAsks = {};

                for (const sym of selectedPairs) {
                    const symData = newDataMap[sym];
                    if (symData && symData.length > 0) {
                        let symEndIdx = 0;
                        for (let j = 0; j < symData.length; j++) {
                            if (symData[j].time <= finalSimTime) symEndIdx = j;
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

            } catch (e) {
                console.error("Failed to fetch session data", e);
            } finally {
                setIsLoadingData(false);
                if (wasRunningBefore) {
                    setIsRunning(true);
                }
            }
        };
        fetchAllData();
        return () => { isCancelled = true; };
    }, [id, initialSelectedPairs, startDate, endDate, timeframe]);

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
        // If data is temporarily empty (reloading), just skip this tick instead of stopping
        if (!masterData || masterData.length === 0) return;

        const nextIndex = currentIndexRef.current + 1;
        if (nextIndex >= masterData.length) {
            setIsRunning(false);
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

        const newBids = { ...bidPricesRef.current };
        const newAsks = { ...askPricesRef.current };
        const tickCheckData = []; // Data for SL/TP check
        const newCandleUpdates = {};

        for (const sym of selectedPairs) {
            const symData = historicalDataMapRef.current[sym];
            if (!symData) continue;

            let left = 0; let right = symData.length - 1; let foundIdx = -1;
            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (symData[mid].time === targetTime) { foundIdx = mid; break; }
                else if (symData[mid].time < targetTime) { foundIdx = mid; left = mid + 1; }
                else right = mid - 1;
            }

            if (foundIdx !== -1) {
                const latest = symData[foundIdx];
                const symUpper = sym.toUpperCase();
                const spreadPoints = SYMBOLS[symUpper]?.spreadPoints || 10;
                const tickSize = SYMBOLS[symUpper]?.tickSize || 0.00001;
                const spreadVal = spreadPoints * tickSize;

                newBids[sym] = latest.close;
                newAsks[sym] = latest.close + spreadVal;

                tickCheckData.push({
                    sym,
                    bid: newBids[sym],
                    ask: newAsks[sym],
                    high: latest.high,
                    low: latest.low
                });

                newCandleUpdates[sym] = latest;
            }
        }

        // Update basic price states
        setSimulatedTime(targetTime);
        currentIndexRef.current = nextIndex;
        setBidPrices(newBids);
        setAskPrices(newAsks);
        bidPricesRef.current = newBids;
        askPricesRef.current = newAsks;

        // Update Candles Map deterministically
        setCandlesMap(prevMap => {
            const newMap = { ...prevMap };
            Object.keys(newCandleUpdates).forEach(sym => {
                const latest = newCandleUpdates[sym];
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
            });
            return newMap;
        });

        // Process SL/TP check using the calculated tickCheckData
        let closedPnL = 0;
        const closed = [];
        const remaining = [];
        let anyClosed = false;

        const currentPositions = positionsRef.current;
        if (currentPositions.length > 0) {
            currentPositions.forEach(pos => {
                const tickData = tickCheckData.find(q => q.sym === pos.symbol);
                if (!tickData) {
                    remaining.push(pos);
                    return;
                }

                const { bid, ask, high, low } = tickData;
                let shouldClose = false;
                let closePriceHit = null;

                const EPSILON = 0.0000001;

                if (pos.type === 'BUY') {
                    if (pos.tp && pos.tp > 0 && high >= (pos.tp - EPSILON)) { shouldClose = true; closePriceHit = pos.tp; }
                    if (pos.sl && pos.sl > 0 && low <= (pos.sl + EPSILON)) { shouldClose = true; closePriceHit = pos.sl; }
                } else {
                    const spreadVal = ask - bid;
                    const highWithSpread = high + spreadVal;
                    const lowWithSpread = low + spreadVal;
                    if (pos.tp && pos.tp > 0 && lowWithSpread <= (pos.tp + EPSILON)) { shouldClose = true; closePriceHit = pos.tp; }
                    if (pos.sl && pos.sl > 0 && highWithSpread >= (pos.sl - EPSILON)) { shouldClose = true; closePriceHit = pos.sl; }
                }

                if (shouldClose) {
                    const executedPrice = closePriceHit || (pos.type === 'BUY' ? bid : ask);
                    const pnl = calculatePnL(pos.openPrice, executedPrice, SYMBOLS[pos.symbol].lotSize, pos.lots, pos.type === 'BUY' ? 1 : -1);
                    closedPnL += pnl;
                    closed.push({ ...pos, closePrice: executedPrice, pnl, closeTime: new Date().toLocaleTimeString(), status: 'closed' });
                    anyClosed = true;
                } else {
                    remaining.push(pos);
                }
            });

            if (anyClosed) {
                setBalance(b => Number((b + closedPnL).toFixed(2)));
                setHistory(prev => {
                    const newHist = [...closed, ...prev];
                    historyRef.current = newHist;
                    return newHist;
                });
                setPositions(remaining);
                positionsRef.current = remaining;
            }
        }

    }, [isRunning, endDate, timeframe, selectedPairs]);

    useEffect(() => {
        if (isRunning) {
            // Speed logic: timeframeFactor (power 0.3) helps scale the delay linearly for better UX.
            // With Speed 1 at M1, realTickInterval will be approx 1000ms.
            const timeframeFactor = Math.pow(timeframe / 60, 0.3); // Reverted from 0.15 to 0.3
            const realTickInterval = Math.max(30, (1000 * timeframeFactor) / speed); // Removed * 2 multiplier and increased min to 30ms
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

    const addSymbolToSession = async (symbol) => {
        if (selectedPairs.includes(symbol)) return;
        
        setIsLoadingData(true);
        try {
            const localData = await getHistoricalData(symbol, 60, 0, Infinity);
            if (!localData || localData.length === 0) {
                alert(`Nenhum dado importado encontrado para ${symbol}. Por favor, importe o CSV deste par primeiro.`);
                return;
            }

            const dEnd = new Date(endDate);
            dEnd.setHours(23, 59, 59, 0);
            const endTimeStamp = Math.floor(dEnd.getTime() / 1000);

            const uniqueMap = new Map();
            for (const row of localData) {
                if (row.time <= endTimeStamp) {
                    uniqueMap.set(row.time, row);
                }
            }
            const sortedData = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
            
            historicalDataMapRef.current[symbol] = sortedData;

            // Sync with current simulatedTime
            let symEndIdx = -1;
            for (let j = 0; j < sortedData.length; j++) {
                if (sortedData[j].time <= simulatedTime) symEndIdx = j;
                else break;
            }

            if (symEndIdx !== -1) {
                const visible = sortedData.slice(0, symEndIdx + 1);
                const aggregated = aggregateData(visible, timeframe);
                const lastCandle = visible[visible.length - 1];
                
                setCandlesMap(prev => ({ ...prev, [symbol]: aggregated }));
                
                const spreadPoints = SYMBOLS[symbol.toUpperCase()]?.spreadPoints || 10;
                const spreadVal = spreadPoints * (SYMBOLS[symbol.toUpperCase()]?.tickSize || 0.00001);
                
                setBidPrices(prev => ({ ...prev, [symbol]: lastCandle.close }));
                setAskPrices(prev => ({ ...prev, [symbol]: lastCandle.close + spreadVal }));
                
                // Update refs for the loop
                bidPricesRef.current[symbol] = lastCandle.close;
                askPricesRef.current[symbol] = lastCandle.close + spreadVal;
            }

            setSelectedPairs(prev => [...prev, symbol]);
            setActiveSymbol(symbol);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingData(false);
        }
    };

    return {
        balance, setBalance,
        equity,
        positions,
        history,
        bidPrices,
        askPrices,
        candlesMap,
        drawingsMap, setDrawingsMap,
        simulatedTime,
        activeSymbol, setActiveSymbol,
        isRunning, setIsRunning,
        speed, setSpeed,
        timeframe, setTimeframe,
        openPosition, closePosition, updatePosition,
        addSymbolToSession,
        removeSymbolFromSession: (symbol) => {
            const hasOpenPositions = positionsRef.current.some(p => p.symbol === symbol);
            if (hasOpenPositions) {
                alert(`Não é possível fechar o par ${symbol} enquanto houver ordens abertas.`);
                return false;
            }
            if (selectedPairs.length <= 1) {
                alert("A sessão deve ter pelo menos um par ativo.");
                return false;
            }

            setSelectedPairs(prev => {
                const filtered = prev.filter(s => s !== symbol);
                if (activeSymbol === symbol && filtered.length > 0) {
                    setActiveSymbol(filtered[0]);
                }
                return filtered;
            });
            return true;
        },
        selectedPairs,
        isLoadingData
    };
};
