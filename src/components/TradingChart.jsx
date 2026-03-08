import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useLayoutEffect } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle } from 'lightweight-charts';

const TradingChart = forwardRef(({
    data,
    askPrice = null,
    colors = {},
    activeTool = null,
    activeColor = '#58a6ff',
    onToolComplete = () => { },
    onDeleteDrawing = () => { },
    separatorConfig = { color: 'rgba(255, 255, 255, 0.2)', width: 1 },
    indicators = [],
    drawings = [],
    setDrawings = () => { },
    positions = [],
    activeSymbol = '',
    onUpdatePosition = () => { },
    timeframe = 'D1',
    timezoneOffset = -3,
    chartBgColor = '#0d1117',
    showGrid = true,
    upCandleColor = '#26a69a',
    downCandleColor = '#ef5350',
    isFollowEnabled = true
}, ref) => {
    const {
        backgroundColor = '#0d1117',
        textColor = '#c9d1d9',
    } = colors;

    const chartContainerRef = useRef();
    const chartRef = useRef();
    const seriesRef = useRef();
    const askSeriesRef = useRef();
    const separatorSeriesRef = useRef();
    const drawingSeriesRef = useRef([]); // To keep track of drawing series
    const indicatorSeriesRef = useRef({}); // { id: series }

    // Refs to avoid re-creating the click handler and chart
    const activeToolRef = useRef(activeTool);
    const activeColorRef = useRef(activeColor);
    const onToolCompleteRef = useRef(onToolComplete);

    const [pendingDrawing, setPendingDrawing] = useState(null);

    useImperativeHandle(ref, () => ({
        center: handleCenter
    }));

    // Interactive States
    const [hoveredDrawingId, setHoveredDrawingId] = useState(null);
    const [selectedDrawingId, setSelectedDrawingId] = useState(null);
    const [draggingDrawingId, setDraggingDrawingId] = useState(null);
    const [draggingHandle, setDraggingHandle] = useState(null); // 'start', 'end', or 'line'
    const [draggingTrade, setDraggingTrade] = useState(null); // { id, type } where type is 'sl' or 'tp'

    // Strict number check because isNaN(null) is false in JS!
    const isValidNumber = (n) => n != null && typeof n === 'number' && !isNaN(n);

    // Using refs for inside event listeners
    const hoveredDrawingIdRef = useRef(hoveredDrawingId);
    const hoveredHandleRef = useRef(null);
    const selectedDrawingIdRef = useRef(selectedDrawingId);
    const draggingDrawingIdRef = useRef(draggingDrawingId);
    const draggingHandleRef = useRef(draggingHandle);
    const draggingTradeRef = useRef(draggingTrade);
    const draggingStartPointRef = useRef(null);
    const drawingsRef = useRef(drawings);
    const positionsRef = useRef(positions);
    const dataRef = useRef(data);
    const onUpdatePositionRef = useRef(onUpdatePosition);

    useEffect(() => { hoveredDrawingIdRef.current = hoveredDrawingId; }, [hoveredDrawingId]);
    useEffect(() => { selectedDrawingIdRef.current = selectedDrawingId; }, [selectedDrawingId]);
    useEffect(() => { draggingDrawingIdRef.current = draggingDrawingId; }, [draggingDrawingId]);
    useEffect(() => { draggingHandleRef.current = draggingHandle; }, [draggingHandle]);
    useEffect(() => { draggingTradeRef.current = draggingTrade; }, [draggingTrade]);
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { positionsRef.current = positions; }, [positions]);
    useEffect(() => { dataRef.current = data; }, [data]);
    useEffect(() => { onUpdatePositionRef.current = onUpdatePosition; }, [onUpdatePosition]);

    // Math Utility: Distance from Point to Line Segment
    const getPointToLineDistance = (x, y, x1, y1, x2, y2) => {
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        if (len_sq !== 0) param = dot / len_sq;
        let xx, yy;
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        const dx = x - xx;
        const dy = y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    };

    // Update refs when props change
    useEffect(() => {
        activeToolRef.current = activeTool;
        activeColorRef.current = activeColor;
        onToolCompleteRef.current = onToolComplete;
    }, [activeTool, activeColor, onToolComplete]);

    useEffect(() => {
        hoveredDrawingIdRef.current = hoveredDrawingId;
    }, [hoveredDrawingId]);

    useEffect(() => {
        drawingsRef.current = drawings;
    }, [drawings]);

    // Initial Chart Setup
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const isLight = chartBgColor.toLowerCase() === '#ffffff';
        const dynamicTextColor = isLight ? '#000000' : '#c9d1d9';
        const gridColor = isLight ? 'rgba(0,0,0,0.1)' : '#21262d';

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: chartBgColor },
                textColor: dynamicTextColor,
            },
            localization: {
                timeFormatter: (timeData) => {
                    if (typeof timeData === 'object' && timeData !== null) {
                        return `${timeData.year} -${String(timeData.month).padStart(2, '0')} -${String(timeData.day).padStart(2, '0')} `;
                    }
                    const shiftedTimestamp = timeData + (timezoneOffset * 3600);
                    const d = new Date(shiftedTimestamp * 1000);
                    return d.toISOString().replace('T', ' ').substring(0, 16);
                },
            },
            grid: {
                vertLines: { visible: false }, // Force off to prevent native lines creating 12-hour pseudo-separators
                horzLines: { color: gridColor, visible: showGrid },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                rightOffset: 150,
                barSpacing: 10,
                fixLeftEdge: true,
                timeVisible: true,
                secondsVisible: false,
            }
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: upCandleColor,
            downColor: downCandleColor,
            borderVisible: true,
            borderColor: '#377dff',
            wickUpColor: upCandleColor,
            wickDownColor: downCandleColor,
            borderUpColor: upCandleColor,
            borderDownColor: downCandleColor,
        });

        const askSeries = chart.addSeries(LineSeries, {
            color: 'rgba(255, 68, 68, 0.7)', // Red with slight transparency
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            priceLineVisible: true,
            lastPriceAnimation: 0,
            title: 'Ask',
        });

        const sepStyle = separatorConfig.style === 'solid' ? LineStyle.Solid : separatorConfig.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed;
        const separatorSeries = chart.addSeries(LineSeries, {
            color: separatorConfig.color,
            lineWidth: separatorConfig.width,
            lineStyle: sepStyle,
            priceScaleId: 'right', // Use main scale to ensure it is rendered within the visible area
            autoscaleInfoProvider: () => null, // Crucial: ignore this series for auto-scaling bounds
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
        });

        // We no longer strictly need the left scale for separators, but we leave it invisible
        chart.priceScale('left').applyOptions({
            visible: false,
            autoScale: false,
            scaleMargins: {
                top: 0,
                bottom: 0,
            },
            priceRange: {
                from: 0,
                to: 1,
            },
            borderVisible: false,
            ticksVisible: false,
        });

        chartRef.current = chart;
        seriesRef.current = series;
        askSeriesRef.current = askSeries;
        separatorSeriesRef.current = separatorSeries;

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
            }
        };
        window.addEventListener('resize', handleResize);

        // Click Handler for Drawings
        chart.subscribeClick((param) => {
            if (!param.point) return;

            // Handle Selection
            if (!activeToolRef.current) {
                if (hoveredDrawingIdRef.current) {
                    setSelectedDrawingId(hoveredDrawingIdRef.current);
                } else {
                    setSelectedDrawingId(null);
                }
                return;
            }

            const logicalX = chart.timeScale().coordinateToLogical(param.point.x);
            let time = param.time; // Fallback

            if (logicalX !== null) {
                const index = Math.floor(logicalX);
                const fraction = logicalX - index;
                const d = dataRef.current;

                if (d && d.length > 1) {
                    if (index < 0) {
                        const timeDiff = d[1].time - d[0].time;
                        time = d[0].time + (logicalX * timeDiff);
                    } else if (index >= d.length - 1) {
                        const timeDiff = d[d.length - 1].time - d[d.length - 2].time;
                        time = d[d.length - 1].time + (fraction * timeDiff);
                    } else {
                        const timeDiff = d[index + 1].time - d[index].time;
                        time = d[index].time + (fraction * timeDiff);
                    }
                }
            }

            const price = series.coordinateToPrice(param.point.y);

            // Normal drawing mode 
            const tool = activeToolRef.current;
            const color = activeColorRef.current;
            const id = Date.now();

            if (tool === 'horizontal') {
                setDrawings(prev => [...prev, { id, type: 'horizontal', price, color }]);
                onToolCompleteRef.current();
            } else if (tool === 'vertical') {
                if (!time) return;
                setDrawings(prev => [...prev, { id, type: 'vertical', time, color }]);
                onToolCompleteRef.current();
            } else if (tool === 'trend' || tool === 'fib') {
                if (!time) return;

                const visibleRange = chart.timeScale().getVisibleLogicalRange();
                let startLogical = visibleRange ? visibleRange.from + (visibleRange.to - visibleRange.from) * 0.1 : null;
                let endLogical = visibleRange ? visibleRange.from + (visibleRange.to - visibleRange.from) * 0.9 : null;

                const d = dataRef.current;
                let startTime = time;
                let endTime = time;

                if (d && d.length > 0 && startLogical !== null && endLogical !== null) {
                    const startIdx = Math.max(0, Math.floor(startLogical));
                    const endIdx = Math.min(d.length - 1, Math.floor(endLogical));
                    startTime = d[startIdx]?.time || time;
                    endTime = d[endIdx]?.time || time + (3600 * 24);
                } else {
                    endTime = time + 86400 * 5;
                }

                // Make the default line sloped instead of perfectly horizontal
                // Lower y on screen is higher price
                const startPrice = series.coordinateToPrice(param.point.y + 40) || price;
                const endPrice = series.coordinateToPrice(param.point.y - 40) || price;

                setDrawings(prev => [...prev, {
                    id,
                    type: tool,
                    start: { time: startTime, price: startPrice },
                    end: { time: endTime, price: endPrice },
                    color
                }]);
                onToolCompleteRef.current();
            }
        });

        // Mouse Events for Dragging
        const handleMouseDown = (e) => {
            if (activeToolRef.current) return;

            if (hoveredDrawingIdRef.current) {
                setDraggingDrawingId(hoveredDrawingIdRef.current);
                setDraggingHandle(hoveredHandleRef.current || 'line');
                draggingHandleRef.current = hoveredHandleRef.current || 'line';
                e.stopPropagation();
                e.preventDefault();
                // Temporarily disable scroll
                if (chartRef.current) {
                    chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
                }
                return;
            }

            // Hit test for trade lines
            const rect = chartContainerRef.current.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const hitThreshold = 12; // Increased threshold for better UX

            for (const pos of positionsRef.current) {
                const slY = seriesRef.current.priceToCoordinate(pos.sl);
                if (slY !== null && Math.abs(y - slY) <= hitThreshold) {
                    setDraggingTrade({ id: pos.id, type: 'sl' });
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
                const tpY = seriesRef.current.priceToCoordinate(pos.tp);
                if (tpY !== null && Math.abs(y - tpY) <= hitThreshold) {
                    setDraggingTrade({ id: pos.id, type: 'tp' });
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
            }
        };

        const handleMouseMove = (e) => {
            if (!draggingTradeRef.current && !draggingDrawingIdRef.current) return;
            if (!chartContainerRef.current || !seriesRef.current) return;

            const rect = chartContainerRef.current.getBoundingClientRect();
            const y = e.clientY - rect.top;

            if (draggingTradeRef.current) {
                chartContainerRef.current.style.cursor = 'ns-resize';
                const price = seriesRef.current.coordinateToPrice(y);
                if (price !== null) {
                    const { id, type } = draggingTradeRef.current;
                    onUpdatePositionRef.current(id, { [type]: Number(price.toFixed(5)) });
                }
            } else if (draggingDrawingIdRef.current) {
                // Drawing dragging logic is slightly different as it needs 'time'
                // For now, we'll keep use the internal crosshair move subscription for drawings 
                // to maintain time-scale consistency, as Lightweight Charts handles this better.
            }
        };

        const handleMouseUp = () => {
            setDraggingTrade(null);
            setDraggingDrawingId(null);
            setDraggingHandle(null);
            draggingHandleRef.current = null;
            draggingStartPointRef.current = null;

            // Re-enable scroll and scale
            if (chartRef.current) {
                chartRef.current.applyOptions({ handleScroll: true, handleScale: true });
            }
        };

        if (chartContainerRef.current) {
            chartContainerRef.current.addEventListener('mousedown', handleMouseDown, true); // Use capture
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        // Hover & Crosshair Handler (Strictly for hover feedback and drawing creation)
        const getLogicalIndexHover = (time) => {
            const currentData = dataRef.current;
            if (!currentData || currentData.length === 0) return null;
            if (time <= currentData[0].time) return 0;
            if (time >= currentData[currentData.length - 1].time) return currentData.length - 1;
            for (let i = 0; i < currentData.length - 1; i++) {
                if (time >= currentData[i].time && time <= currentData[i + 1].time) {
                    const range = currentData[i + 1].time - currentData[i].time;
                    return i + (time - currentData[i].time) / range;
                }
            }
            return null;
        };

        let lastCrosshairX = -1;
        let lastCrosshairY = -1;

        chart.subscribeCrosshairMove((param) => {
            if (!param.point || !chartContainerRef.current) return;
            const x = param.point.x;
            const y = param.point.y;

            if (x === lastCrosshairX && y === lastCrosshairY) {
                return; // Ignore synthetic events from lightweight-charts when changing series
            }
            lastCrosshairX = x;
            lastCrosshairY = y;

            // Drawings Drag (internal)
            if (draggingDrawingIdRef.current && !activeToolRef.current) {
                chartContainerRef.current.style.cursor = 'grabbing';

                const time = param.time;
                const price = series.coordinateToPrice(y);
                if (price === null) return;

                setDrawings(prev => prev.map(d => {
                    if (d.id === draggingDrawingIdRef.current) {
                        if (d.type === 'horizontal') {
                            return { ...d, price };
                        } else if (d.type === 'vertical') {
                            return time ? { ...d, time } : d;
                        } else if (d.type === 'trend' || d.type === 'fib') {
                            if (draggingHandleRef.current === 'start') {
                                return { ...d, start: { time, price } };
                            } else if (draggingHandleRef.current === 'end') {
                                return { ...d, end: { time, price } };
                            } else {
                                if (draggingStartPointRef.current) {
                                    // Use absolute logical X coordinate to translate time correctly
                                    const logX = chart.timeScale().coordinateToLogical(x);
                                    if (logX !== null) {
                                        // On initial click/drag we set the origin
                                        if (draggingStartPointRef.current.initialLogX === undefined) {
                                            const logStart = getLogicalIndexHover(d.start.time);
                                            const logEnd = getLogicalIndexHover(d.end.time);
                                            draggingStartPointRef.current = {
                                                initialLogX: logX,
                                                initialY: y,
                                                initialStartLogX: logStart !== null ? logStart : 0, // safe fallback
                                                initialEndLogX: logEnd !== null ? logEnd : 0,
                                                initialStartPrice: d.start.price,
                                                initialEndPrice: d.end.price
                                            };
                                        }

                                        const startData = draggingStartPointRef.current;

                                        // Calculate delta in logical index space and price space
                                        const deltaLogX = logX - startData.initialLogX;
                                        const deltaPrice = series.coordinateToPrice(startData.initialY) - price; // Inverted as Y goes down

                                        // Apply deltas
                                        const newStartLogX = startData.initialStartLogX + deltaLogX;
                                        const newEndLogX = startData.initialEndLogX + deltaLogX;

                                        // Convert logical index back to time safely
                                        const currentData = dataRef.current;

                                        const getTimeFromLogX = (lx) => {
                                            if (!currentData || currentData.length === 0) return null;
                                            if (lx <= 0) return currentData[0].time;
                                            if (lx >= currentData.length - 1) return currentData[currentData.length - 1].time;
                                            const idx = Math.floor(lx);
                                            const frac = lx - idx;
                                            const t1 = currentData[idx].time;
                                            const t2 = currentData[idx + 1].time;
                                            return t1 + (t2 - t1) * frac;
                                        };

                                        const newStartTime = getTimeFromLogX(newStartLogX);
                                        const newEndTime = getTimeFromLogX(newEndLogX);

                                        if (newStartTime !== null && newEndTime !== null) {
                                            return {
                                                ...d,
                                                start: {
                                                    time: newStartTime,
                                                    price: startData.initialStartPrice - deltaPrice // apply inverted delta
                                                },
                                                end: {
                                                    time: newEndTime,
                                                    price: startData.initialEndPrice - deltaPrice
                                                }
                                            };
                                        }
                                    }
                                } else {
                                    // Safe fallback that initializes the correct object structure 
                                    // even though the main logic block will overwrite it for robustness
                                    draggingStartPointRef.current = { time, price };
                                }
                            }
                        }
                    }
                    return d;
                }));
                return;
            }

            if (activeToolRef.current) {
                chartContainerRef.current.style.cursor = 'crosshair';
                return;
            }

            // Hit Testing Logic for Hover
            let hoveredId = null;
            let hoveredHandleLocal = null;
            const hoverThreshold = 8;
            const currentDrawings = drawingsRef.current;
            const currentData = dataRef.current;

            for (let i = currentDrawings.length - 1; i >= 0; i--) {
                const draw = currentDrawings[i];
                if (draw.type === 'horizontal') {
                    const lineY = series.priceToCoordinate(draw.price);
                    if (lineY !== null && Math.abs(y - lineY) <= hoverThreshold) {
                        hoveredId = draw.id;
                        break;
                    }
                } else if (draw.type === 'vertical') {
                    const logX = getLogicalIndexHover(draw.time);
                    if (logX !== null) {
                        const lineX = chart.timeScale().logicalToCoordinate(logX);
                        if (lineX !== null && Math.abs(x - lineX) <= hoverThreshold) {
                            hoveredId = draw.id;
                            break;
                        }
                    }
                } else if (draw.type === 'trend' || draw.type === 'fib') {
                    const log1 = getLogicalIndexHover(draw.start.time);
                    const log2 = getLogicalIndexHover(draw.end.time);
                    if (log1 !== null && log2 !== null) {
                        const x1 = chart.timeScale().logicalToCoordinate(log1);
                        const y1 = series.priceToCoordinate(draw.start.price);
                        const x2 = chart.timeScale().logicalToCoordinate(log2);
                        const y2 = series.priceToCoordinate(draw.end.price);

                        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
                            const distStart = Math.sqrt(Math.pow(x - x1, 2) + Math.pow(y - y1, 2));
                            const distEnd = Math.sqrt(Math.pow(x - x2, 2) + Math.pow(y - y2, 2));

                            // Increased multiplier for endpoints from 2x to 3x (24px radius) for much easier grabbing
                            if (distStart <= hoverThreshold * 3) {
                                hoveredId = draw.id;
                                hoveredHandleLocal = 'start';
                                break;
                            } else if (distEnd <= hoverThreshold * 3) {
                                hoveredId = draw.id;
                                hoveredHandleLocal = 'end';
                                break;
                            }

                            const dist = getPointToLineDistance(x, y, x1, y1, x2, y2);
                            if (dist <= hoverThreshold) {
                                hoveredId = draw.id;
                                hoveredHandleLocal = 'line';
                                break;
                            }
                        }
                    }
                }
            }

            if (hoveredDrawingIdRef.current !== hoveredId) {
                setHoveredDrawingId(hoveredId);
            }
            if (hoveredHandleRef.current !== hoveredHandleLocal) {
                hoveredHandleRef.current = hoveredHandleLocal;
                // We shouldn't setState draggingHandle here, it's set on mouseDown.
            }

            // Cursor management
            if (hoveredId) {
                if (hoveredHandleLocal === 'start' || hoveredHandleLocal === 'end') {
                    chartContainerRef.current.style.cursor = 'crosshair';
                } else {
                    chartContainerRef.current.style.cursor = 'pointer';
                }
            } else {
                // Check if hovering over SL/TP
                let tradeHover = false;
                const tradeThreshold = 12;
                for (const pos of positionsRef.current) {
                    const slY = seriesRef.current.priceToCoordinate(pos.sl);
                    if (slY !== null && Math.abs(y - slY) <= tradeThreshold) tradeHover = true;
                    const tpY = seriesRef.current.priceToCoordinate(pos.tp);
                    if (tpY !== null && Math.abs(y - tpY) <= tradeThreshold) tradeHover = true;
                }
                chartContainerRef.current.style.cursor = tradeHover ? 'ns-resize' : 'default';
            }
        });

        return () => {
            if (chartContainerRef.current) {
                chartContainerRef.current.removeEventListener('mousedown', handleMouseDown);
            }
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []); // Run once on mount

    // Effect to handle dynamic theme changes without re-creating the chart
    useEffect(() => {
        if (!chartRef.current || !seriesRef.current) return;

        const isLight = chartBgColor.toLowerCase() === '#ffffff';
        const dynamicTextColor = isLight ? '#000000' : '#c9d1d9';
        const gridColor = isLight ? 'rgba(0,0,0,0.1)' : '#21262d';

        chartRef.current.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: chartBgColor },
                textColor: dynamicTextColor,
            },
            grid: {
                vertLines: { visible: false }, // Force off to prevent native lines creating 12-hour pseudo-separators
                horzLines: { color: gridColor, visible: showGrid },
            }
        });

        seriesRef.current.applyOptions({
            upColor: upCandleColor,
            downColor: downCandleColor,
            wickUpColor: upCandleColor,
            wickDownColor: downCandleColor,
            borderUpColor: upCandleColor,
            borderDownColor: downCandleColor,
        });
    }, [chartBgColor, showGrid, upCandleColor, downCandleColor]);

    const lastAskTimeRef = useRef({ lastTime: null, firstTime: null });

    useEffect(() => {
        if (askSeriesRef.current && askPrice !== null && data && data.length > 0) { // Check Ask Series bounds to prevent crash
            const deduplicatedData = data; // Assuming 'data' is the source, if 'deduplicatedData' is meant to be a separate filtered array, it needs to be defined.
            const lastCandle = deduplicatedData[deduplicatedData.length - 1];
            const firstCandle = deduplicatedData[0];

            if (isValidNumber(askPrice)) {
                // If the first candle changed, it means the entire dataset was replaced (user changed dates)
                // We MUST clear out old Ask points to prevent timescale mismatches that crash lightweight-charts
                if (
                    lastAskTimeRef.current.lastTime == null ||
                    firstCandle.time !== lastAskTimeRef.current.firstTime ||
                    lastCandle.time <= lastAskTimeRef.current.lastTime
                ) {
                    // Time reversed, dataset fully replaced, or initializing
                    if (isValidNumber(lastCandle.time) && isValidNumber(askPrice)) {
                        askSeriesRef.current.setData([{ time: lastCandle.time, value: askPrice }]);
                    }
                } else {
                    // Normal progression forward tick-by-tick
                    if (isValidNumber(lastCandle.time) && isValidNumber(askPrice)) {
                        askSeriesRef.current.update({ time: lastCandle.time, value: askPrice });
                    }
                }
                lastAskTimeRef.current = { lastTime: lastCandle.time, firstTime: firstCandle.time };
            }
        }
    }, [askPrice, data]);

    // Handle Keyboard Deletion
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedDrawingId) {
                    setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
                    setSelectedDrawingId(null);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedDrawingId, setDrawings]);

    // Update Separator Options
    useEffect(() => {
        if (separatorSeriesRef.current) {
            const isDotted = separatorConfig.style === 'dotted';
            const isSolid = separatorConfig.style === 'solid';
            separatorSeriesRef.current.applyOptions({
                color: separatorConfig.color,
                lineWidth: separatorConfig.width,
                lineStyle: isDotted ? LineStyle.Dotted : isSolid ? LineStyle.Solid : LineStyle.Dashed
            });
        }
    }, [separatorConfig]);

    // Data Update Logic
    useLayoutEffect(() => {
        if (!seriesRef.current || !chartRef.current) return;

        if (!data || data.length === 0) {
            seriesRef.current.setData([]);
            if (separatorSeriesRef.current) separatorSeriesRef.current.setData([]);
            if (askSeriesRef.current) askSeriesRef.current.setData([]);
            lastAskTimeRef.current = { lastTime: null, firstTime: null };
            return;
        }

        // Filter data to ensure no invalid times reach the series
        const validData = data.filter(d =>
            isValidNumber(d.time) && isValidNumber(d.open) && isValidNumber(d.close) &&
            isValidNumber(d.high) && isValidNumber(d.low)
        );

        if (validData.length === 0) {
            seriesRef.current.setData([]);
            if (separatorSeriesRef.current) separatorSeriesRef.current.setData([]);
            if (askSeriesRef.current) askSeriesRef.current.setData([]);
            lastAskTimeRef.current = { lastTime: null, firstTime: null };
            return;
        }

        // Only update if data actually changed to avoid render loops
        seriesRef.current.setData(validData);

        if (separatorSeriesRef.current) {
            const lineData = [];
            let isTop = false;
            let lastPushedTime = -1;

            const pushPoint = (time, value) => {
                if (time > lastPushedTime) {
                    lineData.push({ time, value });
                    lastPushedTime = time;
                }
            };

            if (validData.length > 0) {
                pushPoint(validData[0].time, isTop ? 999999 : -999999);
            }

            for (let i = 1; i < validData.length; i++) {
                const prev = validData[i - 1];
                const curr = validData[i];

                // Forex Standard: Trading day starts at 17:00 EST, which aligns with 00:00 EET (UTC+2 or UTC+3 depending on DST)
                // MT5 brokers predominantly use EET. We use a fixed MT5 server offset (+2 hours) 
                // to precisely match the visual Day Boundaries that traders expect.
                const MT5_SERVER_OFFSET_HOURS = 2; // EET
                const prevServerSecs = prev.time + (MT5_SERVER_OFFSET_HOURS * 3600);
                const currServerSecs = curr.time + (MT5_SERVER_OFFSET_HOURS * 3600);

                let isNewPeriod = false;

                // Show day separators for H4 and below (14400s) -> Every 24 hours
                if (timeframe <= 14400) {
                    const prevDay = Math.floor(prevServerSecs / 86400);
                    const currDay = Math.floor(currServerSecs / 86400);
                    if (currDay !== prevDay) {
                        isNewPeriod = true;
                    }
                } else {
                    // For Daily charts and above, separate by month
                    const prevDate = new Date(prevServerSecs * 1000);
                    const currDate = new Date(currServerSecs * 1000);
                    if (currDate.getUTCMonth() !== prevDate.getUTCMonth()) {
                        isNewPeriod = true;
                    }
                }

                if (isNewPeriod) {
                    // Jump from bottom of universe to top of universe between the two candles
                    // This creates a steep diagonal line that perfectly mimics a vertical separator 
                    // without injecting fake timestamps that distort the chart.
                    pushPoint(prev.time, isTop ? 999999 : -999999);
                    isTop = !isTop;
                    pushPoint(curr.time, isTop ? 999999 : -999999);
                }
            }

            if (validData.length > 1) {
                pushPoint(validData[validData.length - 1].time, isTop ? 999999 : -999999);
            }
            separatorSeriesRef.current.setData(lineData);
        }

        if (isFollowEnabled) {
            // If it's the first data load or we are following, fit it
            if (data.length <= 100) {
                chartRef.current.timeScale().fitContent();
            }
            chartRef.current.timeScale().scrollToPosition(0, false);
            chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        }
    }, [data, isFollowEnabled, timeframe, separatorConfig]);

    // Update Drawings on Chart
    useLayoutEffect(() => {
        if (!chartRef.current) return;

        // Clear old drawing series and price lines
        drawingSeriesRef.current.forEach(s => {
            try {
                if (s.priceLine && seriesRef.current) {
                    seriesRef.current.removePriceLine(s.priceLine);
                } else if (!s.priceLine && chartRef.current) {
                    chartRef.current.removeSeries(s);
                }
            } catch (e) {
                console.warn("Could not remove drawing:", e);
            }
        });
        drawingSeriesRef.current = [];

        if (!data || data.length === 0) return;
        const validData = data.filter(d => d.time != null && !isNaN(d.time) && !isNaN(new Date(d.time * 1000).getTime()));

        drawings.forEach(draw => {
            const isSelected = draw.id === selectedDrawingId;
            const isHovered = draw.id === hoveredDrawingId;
            const width = isSelected ? 4 : isHovered ? 3 : 2;
            const baseColor = draw.color || '#58a6ff';

            if (draw.type === 'horizontal') {
                const line = seriesRef.current.createPriceLine({
                    price: draw.price,
                    color: isSelected ? '#ffffff' : baseColor,
                    lineWidth: width,
                    lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Solid,
                    axisLabelVisible: true,
                    title: isSelected ? 'Selected' : '',
                });
                drawingSeriesRef.current.push({ priceLine: line });
            } else if (draw.type === 'vertical') {
                const s = chartRef.current.addSeries(LineSeries, {
                    color: isSelected ? '#ffffff' : (draw.color || 'rgba(255, 165, 0, 0.8)'),
                    lineWidth: width,
                    lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Solid,
                    crosshairMarkerVisible: false,
                    lastValueVisible: false,
                    priceLineVisible: false
                });

                const timeArr = validData.map(d => d.time);
                if (timeArr.length > 0 && draw.time != null && !isNaN(draw.time)) {
                    let closestTime = timeArr.reduce((prev, curr) => Math.abs(curr - draw.time) < Math.abs(prev - draw.time) ? curr : prev, timeArr[0]);

                    if (closestTime != null && !isNaN(closestTime)) {
                        // Extract global min/max price constraints
                        const allPrices = validData.map(d => [d.high, d.low]).flat().filter(p => p != null && !isNaN(p));
                        if (allPrices.length > 0) {
                            const minP = Math.min(...allPrices);
                            const maxP = Math.max(...allPrices);
                            s.setData([
                                { time: closestTime, value: minP * 0.5 }, // stretch down
                                { time: closestTime + 1, value: maxP * 1.5 }  // stretch up
                            ]);
                            drawingSeriesRef.current.push(s);
                        }
                    }
                }
            } else if (draw.type === 'trend') {
                const s = chartRef.current.addSeries(LineSeries, {
                    color: isSelected ? '#ffffff' : baseColor,
                    lineWidth: width,
                    lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Solid,
                    crosshairMarkerVisible: false,
                    lastValueVisible: false,
                    priceLineVisible: false
                });

                let p1 = { time: draw.start.time, value: draw.start.price };
                let p2 = { time: draw.end.time, value: draw.end.price };

                if (p1.time === p2.time) {
                    p2.time += 0.001; // Prevent div zero
                }

                // Mathematical Linear Interpolation for Timeframes: Y = m*X + b
                const slope_m = (p2.value - p1.value) / (p2.time - p1.time);
                const intercept_b = p1.value - (slope_m * p1.time);

                const minT = Math.min(draw.start.time, draw.end.time);
                const lineDataMap = new Map();

                for (let i = 0; i < validData.length; i++) {
                    const t = validData[i].time;
                    if (t >= minT && t != null && !isNaN(t)) {
                        const val = (slope_m * t) + intercept_b;
                        if (val != null && !isNaN(val)) {
                            lineDataMap.set(t, { time: t, value: val });
                        }
                    }
                }

                if (lineDataMap.size > 0) {
                    const sortedData = Array.from(lineDataMap.values()).sort((a, b) => a.time - b.time);

                    // CRITICAL FIX: To prevent candles from disappearing due to extreme scale, 
                    // we clamp the trend line values to a reasonable range around the current data view.
                    const allPrices = validData.map(d => [d.high, d.low]).flat().filter(p => !isNaN(p));
                    const minVisible = Math.min(...allPrices);
                    const maxVisible = Math.max(...allPrices);
                    const padding = (maxVisible - minVisible) * 5;

                    const clampedData = sortedData.map(d => ({
                        time: d.time,
                        value: Math.max(minVisible - padding, Math.min(maxVisible + padding, d.value))
                    }));

                    if (clampedData.every(d => d.time != null && !isNaN(d.time) && d.value != null && !isNaN(d.value))) {
                        s.setData(clampedData);
                        drawingSeriesRef.current.push(s);
                    }
                }
            } else if (draw.type === 'fib') {
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                const diff = draw.end.price - draw.start.price;
                const minT = Math.min(draw.start.time, draw.end.time);

                levels.forEach(lvl => {
                    const s = chartRef.current.addSeries(LineSeries, {
                        color: isSelected ? '#ffffff' : (draw.color || (lvl === 0.5 ? 'rgba(248, 81, 73, 0.6)' : 'rgba(139, 148, 158, 0.6)')),
                        lineWidth: isSelected ? 2 : 1,
                        lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Dotted,
                        title: `${(lvl * 100).toFixed(1)}% `,
                        lastValueVisible: false,
                        priceLineVisible: false
                    });

                    const lvlPrice = draw.start.price + diff * lvl;
                    const fibDataMap = new Map();

                    for (let i = 0; i < validData.length; i++) {
                        const t = validData[i].time;
                        if (t >= minT && t != null && !isNaN(t) && lvlPrice != null && !isNaN(lvlPrice)) {
                            fibDataMap.set(t, { time: t, value: lvlPrice });
                        }
                    }

                    if (fibDataMap.size > 0) {
                        const sortedData = Array.from(fibDataMap.values()).sort((a, b) => a.time - b.time);
                        if (sortedData.every(d => d.time != null && !isNaN(d.time) && d.value != null && !isNaN(d.value))) {
                            s.setData(sortedData);
                            drawingSeriesRef.current.push(s);
                        } else {
                            console.error("Fib Line invalid data array:", sortedData);
                        }
                    }
                });
            }
        });

        // --- TRADE LINES RENDERING ---
        console.log(`[Chart] Rendering trade lines for ${positions.length} positions on ${activeSymbol} `);
        positions.forEach(pos => {
            // Only draw lines for the active symbol being displayed
            if (activeSymbol && pos.symbol.toUpperCase() !== activeSymbol.toUpperCase()) return;

            if (!data || data.length === 0) return;

            const digits = 5;
            const isBuy = pos.type === 'BUY';

            // 1. Entry Line
            const entryColor = isBuy ? '#00cc88' : '#ff4444'; // Green for BUY, Red for SELL
            const entryLine = seriesRef.current.createPriceLine({
                price: pos.openPrice,
                color: entryColor,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: `${pos.type} ${pos.lots.toFixed(2)} `,
            });
            drawingSeriesRef.current.push({ priceLine: entryLine });

            if (pos.sl) {
                const slLine = seriesRef.current.createPriceLine({
                    price: pos.sl,
                    color: '#ff4444', // Brighter red
                    lineWidth: 2,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: `SL: ${pos.sl.toFixed(digits)} `,
                });
                drawingSeriesRef.current.push({ priceLine: slLine });
            }

            if (pos.tp) {
                const tpLine = seriesRef.current.createPriceLine({
                    price: pos.tp,
                    color: '#00cc88', // Brighter green
                    lineWidth: 2,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: `TP: ${pos.tp.toFixed(digits)} `,
                });
                drawingSeriesRef.current.push({ priceLine: tpLine });
            }
        });
    }, [drawings, timeframe, data, positions, activeSymbol]);


    const handleCenter = () => {
        if (!chartRef.current) return;
        chartRef.current.timeScale().fitContent();
        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
    };

    // EFFECT:    // Update Indicators
    useLayoutEffect(() => {
        if (!chartRef.current) return;

        if (!data || data.length === 0) {
            Object.values(indicatorSeriesRef.current).forEach(s => s.setData([]));
            return;
        }

        // 1. Remove series that are no longer in the indicators list
        Object.keys(indicatorSeriesRef.current).forEach(id => {
            if (!indicators.find(ind => ind.id.toString() === id)) {
                try {
                    chartRef.current.removeSeries(indicatorSeriesRef.current[id]);
                    delete indicatorSeriesRef.current[id];
                } catch (e) {
                    console.error("Error removing indicator series:", e);
                }
            }
        });

        // 2. Add/Update series for current indicators
        indicators.forEach(ind => {
            let s = indicatorSeriesRef.current[ind.id];
            if (!s) {
                s = chartRef.current.addLineSeries({
                    color: ind.color,
                    lineWidth: 2,
                    priceScaleId: 'right',
                    title: `${ind.type} (${ind.period})`,
                });
                indicatorSeriesRef.current[ind.id] = s;
            }

            // Calculate & Update only if we have enough data
            if (data.length < ind.period) {
                s.setData([]);
                return;
            }
            if (ind.type === 'SMA') {
                const smaData = [];
                for (let i = ind.period - 1; i < data.length; i++) {
                    const slice = data.slice(i - ind.period + 1, i + 1);
                    const sum = slice.reduce((acc, curr) => acc + (curr.close || 0), 0);
                    const val = sum / ind.period;
                    if (isValidNumber(val) && isValidNumber(data[i].time)) {
                        smaData.push({
                            time: data[i].time,
                            value: val
                        });
                    }
                }
                s.setData(smaData);
            } else if (ind.type === 'EMA') {
                const emaData = [];
                const k = 2 / (ind.period + 1);
                let prevEma = data[0].close || 0;

                for (let i = 0; i < data.length; i++) {
                    const currentEma = i === 0 ? prevEma : ((data[i].close || 0) - prevEma) * k + prevEma;
                    if (i >= ind.period - 1) {
                        if (isValidNumber(currentEma) && isValidNumber(data[i].time)) {
                            emaData.push({
                                time: data[i].time,
                                value: currentEma
                            });
                        }
                    }
                    prevEma = currentEma;
                }
                s.setData(emaData);
            }
        });
    }, [indicators, data]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div
                ref={chartContainerRef}
                style={{ width: '100%', height: '100%' }}
            />
            {activeTool && (
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--accent-color)',
                    padding: '5px 15px',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    color: 'white',
                    zIndex: 1000,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}>
                    Tool Active: {activeTool.toUpperCase()} {pendingDrawing ? '(Click end point)' : '(Click start point)'}
                </div>
            )}
        </div>
    );
});

export default TradingChart;
