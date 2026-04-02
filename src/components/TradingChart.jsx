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
    const separatorSeriesRef = useRef(); // No longer used for histogram, but we'll use a new ref for multiple series
    const autoSeparatorSeriesRef = useRef([]);
    const drawingSeriesRef = useRef([]); 
    const indicatorSeriesRef = useRef({}); 

    const activeToolRef = useRef(activeTool);
    const activeColorRef = useRef(activeColor);
    const onToolCompleteRef = useRef(onToolComplete);
    
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);
    useEffect(() => { onToolCompleteRef.current = onToolComplete; }, [onToolComplete]);
    const ghostUpdateRef = useRef(() => { });
    const ghostSeriesRef = useRef();
    const ghostHorizontalRef = useRef();
    const ghostVerticalRef = useRef();

    const dataRef = useRef(data);
    useEffect(() => { dataRef.current = data; }, [data]);

    const getLogicalIndexHover = useCallback((time) => {
        const vData = dataRef.current;
        if (!vData || vData.length === 0) return null;
        const tf = (typeof timeframe === 'number' && !isNaN(timeframe)) ? timeframe : 60;
        const firstT = vData[0].time;
        
        let low = 0, high = vData.length - 1;
        while (low <= high) {
            let mid = (low + high) >> 1;
            if (vData[mid].time === time) return mid;
            if (vData[mid].time < time) low = mid + 1;
            else high = mid - 1;
        }
        return (time - firstT) / tf;
    }, [timeframe]);

    const getTimeFromLogX = useCallback((logX) => {
        const vData = dataRef.current;
        if (!vData || vData.length === 0) return null;
        const tf = (typeof timeframe === 'number' && !isNaN(timeframe)) ? timeframe : 60;
        const firstT = vData[0].time;
        const lastT = vData[vData.length - 1].time;
        const count = vData.length;

        if (logX < 0) return firstT + Math.round(logX) * tf;
        if (logX >= count - 1) return lastT + Math.round(logX - (count - 1)) * tf;
        
        const idx = Math.floor(logX);
        const frac = logX - idx;
        if (idx < count - 1 && frac > 0) {
            return vData[idx].time + (vData[idx + 1].time - vData[idx].time) * frac;
        }
        return vData[Math.max(0, Math.min(count - 1, idx))].time;
    }, [timeframe]);

    const [pendingDrawing, setPendingDrawing] = useState(null);
    const pendingDrawingRef = useRef(null);
    useEffect(() => { pendingDrawingRef.current = pendingDrawing; }, [pendingDrawing]);

    useImperativeHandle(ref, () => ({
        center: handleCenter
    }));

    const [hoveredDrawingId, setHoveredDrawingId] = useState(null);
    const [selectedDrawingId, setSelectedDrawingId] = useState(null);
    const selectedDrawingIdRef = useRef(null);
    useEffect(() => { selectedDrawingIdRef.current = selectedDrawingId; }, [selectedDrawingId]);
    const [draggingDrawingId, setDraggingDrawingId] = useState(null);
    const [draggingHandle, setDraggingHandle] = useState(null); 
    const [draggingTrade, setDraggingTrade] = useState(null); 
    // Validação robusta que aceita strings numéricas (comum em CSV/JSON)
    const isValidNumber = (n) => n !== null && n !== undefined && n !== '' && !isNaN(Number(n));

    const hoveredDrawingIdRef = useRef(hoveredDrawingId);
    const hoveredHandleRef = useRef(null);
    const draggingDrawingIdRef = useRef(draggingDrawingId);
    const draggingHandleRef = useRef(draggingHandle);
    const draggingTradeRef = useRef(draggingTrade);
    const draggingStartPointRef = useRef(null);
    const isDraggingRef = useRef(false);
    const ignoreNextClickRef = useRef(false);
    const drawingsRef = useRef(drawings);
    const positionsRef = useRef(positions);
    const onUpdatePositionRef = useRef(onUpdatePosition);
    const setDrawingsRef = useRef(setDrawings);

    useEffect(() => { draggingDrawingIdRef.current = draggingDrawingId; }, [draggingDrawingId]);
    useEffect(() => { draggingHandleRef.current = draggingHandle; }, [draggingHandle]);
    useEffect(() => { draggingTradeRef.current = draggingTrade; }, [draggingTrade]);
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { positionsRef.current = positions; }, [positions]);
    useEffect(() => { onUpdatePositionRef.current = onUpdatePosition; }, [onUpdatePosition]);
    useEffect(() => { setDrawingsRef.current = setDrawings; }, [setDrawings]);
    useEffect(() => { hoveredDrawingIdRef.current = hoveredDrawingId; }, [hoveredDrawingId]);

    const getPointToLineDistance = (x, y, x1, y1, x2, y2, isInfinite = false) => {
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        if (len_sq === 0) return Math.sqrt(A * A + B * B);
        let param = dot / len_sq;
        let xx, yy;
        if (!isInfinite) {
            if (param < 0) { xx = x1; yy = y1; }
            else if (param > 1) { xx = x2; yy = y2; }
            else { xx = x1 + param * C; yy = y1 + param * D; }
        } else {
            xx = x1 + param * C; yy = y1 + param * D;
        }
        const dx = x - xx; const dy = y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const getHitDrawing = useCallback((x, y) => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) return null;
        const hitThreshold = 40;
        const handleRadius = 60;
        const currentDrawings = drawingsRef.current;
        for (let i = currentDrawings.length - 1; i >= 0; i--) {
            const draw = currentDrawings[i];
            if (draw.type === 'horizontal') {
                const lineY = series.priceToCoordinate(draw.price);
                if (lineY !== null && Math.abs(y - lineY) <= hitThreshold) return { id: draw.id, handle: 'line' };
            } else if (draw.type === 'vertical') {
                const logX = getLogicalIndexHover(draw.time);
                if (logX !== null) {
                    const lineX = chart.timeScale().logicalToCoordinate(logX);
                    if (lineX !== null && Math.abs(x - lineX) <= hitThreshold) return { id: draw.id, handle: 'line' };
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
                        if (Math.sqrt((x-x1)**2+(y-y1)**2) <= handleRadius) return { id: draw.id, handle: 'start' };
                        if (Math.sqrt((x-x2)**2+(y-y2)**2) <= handleRadius) return { id: draw.id, handle: 'end' };
                        const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
                        if (Math.sqrt((x-mx)**2+(y-my)**2) <= handleRadius) return { id: draw.id, handle: 'line' };
                        const dist = getPointToLineDistance(x, y, x1, y1, x2, y2, false); 
                        if (dist <= hitThreshold) return { id: draw.id, handle: 'line' };
                    }
                }
            }
        }
        return null;
    }, [getLogicalIndexHover]);

    useEffect(() => {
        if (!chartContainerRef.current) return;
        const isLight = chartBgColor.toLowerCase() === '#ffffff';
        const dynamicTextColor = isLight ? '#000000' : '#c9d1d9';
        const gridColor = isLight ? 'rgba(0,0,0,0.1)' : '#21262d';
        const chart = createChart(chartContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: chartBgColor }, textColor: dynamicTextColor },
            localization: {
                timeFormatter: (t) => {
                    if (typeof t === 'object' && t !== null) return `${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`;
                    const d = new Date((t + (timezoneOffset * 3600)) * 1000);
                    return d.toISOString().replace('T',' ').substring(0,16);
                }
            },
            grid: { vertLines: { visible: false }, horzLines: { color: gridColor, visible: showGrid } },
            width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight,
            rightPriceScale: {
                width: 80, // Wider for mobile touch
                borderVisible: false,
                alignLabels: true,
            },
            handleScroll: {
                vertTouchDrag: true,
                horzTouchDrag: true,
                mouseWheel: true,
                pressedMouseMove: true,
            },
            timeScale: { rightOffset: 150, barSpacing: 10, fixLeftEdge: true, timeVisible: true }
        });
        const series = chart.addSeries(CandlestickSeries, {
            upColor: upCandleColor, downColor: downCandleColor, borderVisible: true,
            wickUpColor: upCandleColor, wickDownColor: downCandleColor,
            borderUpColor: upCandleColor, borderDownColor: downCandleColor
        });
        const askSeries = chart.addSeries(LineSeries, {
            color: 'rgba(255, 68, 68, 0.7)', lineWidth: 1, lastValueVisible: true, title: 'Ask'
        });
        const sepStyle = separatorConfig.style === 'solid' ? LineStyle.Solid : separatorConfig.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed;
        chartRef.current = chart; seriesRef.current = series; askSeriesRef.current = askSeries;

        const ghostSeries = chart.addSeries(LineSeries, {
            color: activeColorRef.current, lineWidth: 2, lineStyle: LineStyle.Dashed,
            autoscaleInfoProvider: () => null, visible: false
        });
        const ghostHorizontal = series.createPriceLine({ price: 0, color: 'transparent', lineWidth: 1, lineStyle: LineStyle.Dashed });
        const ghostVertical = chart.addSeries(LineSeries, {
            color: activeColorRef.current, lineWidth: 2, lineStyle: LineStyle.Dotted,
            autoscaleInfoProvider: () => null, visible: false
        });
        ghostSeriesRef.current = ghostSeries; ghostHorizontalRef.current = ghostHorizontal; ghostVerticalRef.current = ghostVertical;

        ghostUpdateRef.current = (draw) => {
            if (!draw) {
                ghostSeries.applyOptions({ visible: false });
                ghostHorizontal.applyOptions({ color: 'transparent' });
                ghostVertical.applyOptions({ visible: false });
                return;
            }
            if (draw.type === 'trend' || draw.type === 'fib') {
                ghostSeries.applyOptions({ visible: true, color: activeColorRef.current });
                const p1 = draw.start, p2 = draw.end;
                const slope = (p2.price - p1.price) / (p2.time - p1.time || 0.00001);
                const intercept = p1.price - (slope * p1.time);
                const vData = dataRef.current;
                if (vData.length) {
                    ghostSeries.setData([{ time: vData[0].time, value: slope * vData[0].time + intercept },
                                         { time: vData[vData.length-1].time, value: slope * vData[vData.length-1].time + intercept }]);
                }
            } else if (draw.type === 'horizontal') {
                ghostHorizontal.applyOptions({ color: activeColorRef.current, price: draw.price });
            } else if (draw.type === 'vertical') {
                ghostVertical.applyOptions({ visible: true, color: activeColorRef.current });
                const allPrices = dataRef.current.map(d => [d.high, d.low]).flat().filter(isValidNumber);
                if (allPrices.length) {
                    ghostVertical.setData([{ time: draw.time, value: Math.min(...allPrices)*0.5 }, { time: draw.time, value: Math.max(...allPrices)*1.5 }]);
                }
            }
        };

        const handleClick = (param) => {
            if (!param.point || ignoreNextClickRef.current) { ignoreNextClickRef.current = false; return; }
            if (!activeToolRef.current) { setSelectedDrawingId(hoveredDrawingIdRef.current); return; }
            const logicalX = chart.timeScale().coordinateToLogical(param.point.x);
            const price = series.coordinateToPrice(param.point.y);
            if (logicalX === null || price === null) return;
            const finalTime = getTimeFromLogX(logicalX);
            const tool = activeToolRef.current;
            const color = activeColorRef.current;
            const id = Date.now().toString() + Math.random().toString(36).substring(2, 9);

            if (tool === 'horizontal') { setDrawingsRef.current(prev => [...prev, { id, type: 'horizontal', price: Number(price.toFixed(5)), color }]); onToolCompleteRef.current(); }
            else if (tool === 'vertical') { setDrawingsRef.current(prev => [...prev, { id, type: 'vertical', time: finalTime, color }]); onToolCompleteRef.current(); }
            else if (tool === 'trend' || tool === 'fib') {
                if (!pendingDrawingRef.current) {
                    const start = { time: finalTime, price: Number(price.toFixed(5)) };
                    const initial = { type: tool, start, end: { ...start, time: getTimeFromLogX(logicalX + 1) } };
                    pendingDrawingRef.current = initial; setPendingDrawing(initial);
                    ghostUpdateRef.current(initial);
                } else {
                    const draw = { id, type: tool, start: pendingDrawingRef.current.start, end: { time: finalTime, price: Number(price.toFixed(5)) }, color };
                    setDrawingsRef.current(prev => [...prev, draw]);
                    setSelectedDrawingId(id); pendingDrawingRef.current = null; setPendingDrawing(null); onToolCompleteRef.current();
                }
            }
        };
        chart.subscribeClick(handleClick);

        const handleDown = (clientX, clientY, e) => {
            const rect = chartContainerRef.current.getBoundingClientRect();
            const x = clientX - rect.left, y = clientY - rect.top;
            const hit = getHitDrawing(x, y);
            if (hit) {
                if (activeToolRef.current) ignoreNextClickRef.current = true;
                setSelectedDrawingId(hit.id); setDraggingDrawingId(hit.id); setDraggingHandle(hit.handle); draggingHandleRef.current = hit.handle;
                const d = drawingsRef.current.find(i => i.id === hit.id);
                const logX = chart.timeScale().coordinateToLogical(x);
                const p = series.coordinateToPrice(y);
                if (d && logX !== null && p !== null) {
                    draggingStartPointRef.current = { initialLogX: logX, initialPrice: p, 
                        initialStartLogX: getLogicalIndexHover(d.type === 'horizontal' ? 0 : (d.start ? d.start.time : d.time)),
                        initialEndLogX: getLogicalIndexHover(d.end ? d.end.time : 0),
                        initialStartPrice: d.start ? d.start.price : (d.price || 0),
                        initialEndPrice: d.end ? d.end.price : (d.price || 0) };
                }
                chart.applyOptions({ handleScroll: false, handleScale: false });
                isDraggingRef.current = true; if (e.cancelable) e.preventDefault(); e.stopPropagation(); return;
            }
            setSelectedDrawingId(null);
            for (const pos of positionsRef.current) {
                const slY = isValidNumber(pos.sl) ? series.priceToCoordinate(pos.sl) : null;
                const tpY = isValidNumber(pos.tp) ? series.priceToCoordinate(pos.tp) : null;
                const entryY = series.priceToCoordinate(pos.openPrice);

                if (slY !== null && Math.abs(y - slY) <= 40) { setDraggingTrade({ id: pos.id, type: 'sl' }); draggingTradeRef.current = { id: pos.id, type: 'sl' }; chart.applyOptions({ handleScroll: false }); return; }
                if (tpY !== null && Math.abs(y - tpY) <= 40) { setDraggingTrade({ id: pos.id, type: 'tp' }); draggingTradeRef.current = { id: pos.id, type: 'tp' }; chart.applyOptions({ handleScroll: false }); return; }
                if (entryY !== null && Math.abs(y - entryY) <= 40) {
                    // Dragging entry to create SL/TP
                    setDraggingTrade({ id: pos.id, type: 'entry-drag', initialY: entryY });
                    draggingTradeRef.current = { id: pos.id, type: 'entry-drag', initialY: entryY };
                    chart.applyOptions({ handleScroll: false });
                    return;
                }
            }
        };

        const handleMove = (clientX, clientY) => {
            const rect = chartContainerRef.current.getBoundingClientRect();
            const x = clientX - rect.left, y = clientY - rect.top;
            if (activeToolRef.current && pendingDrawingRef.current) {
                const p = series.coordinateToPrice(y), lx = chart.timeScale().coordinateToLogical(x);
                if (p !== null && lx !== null) {
                    const updated = { ...pendingDrawingRef.current, end: { time: getTimeFromLogX(lx), price: p } };
                    pendingDrawingRef.current = updated; ghostUpdateRef.current(updated);
                }
                return;
            }
            if (draggingTradeRef.current) {
                const p = series.coordinateToPrice(y);
                if (p !== null) {
                    const drag = draggingTradeRef.current;
                    if (drag.type === 'entry-drag') {
                        const pos = positionsRef.current.find(i => i.id === drag.id);
                        if (pos) {
                            const isBuy = pos.type === 'BUY';
                            const priceIsAboveEntry = p > pos.openPrice;
                            const type = isBuy ? (priceIsAboveEntry ? 'tp' : 'sl') : (priceIsAboveEntry ? 'sl' : 'tp');
                            
                            const newDrag = { id: drag.id, type };
                            setDraggingTrade(newDrag);
                            draggingTradeRef.current = newDrag;
                            onUpdatePositionRef.current(drag.id, { [type]: Number(p.toFixed(5)) });
                        }
                    } else {
                        onUpdatePositionRef.current(drag.id, { [drag.type]: Number(p.toFixed(5)) });
                    }
                }
            } else if (draggingDrawingIdRef.current) {
                const lx = chart.timeScale().coordinateToLogical(x), p = series.coordinateToPrice(y);
                if (lx === null || p === null || !draggingStartPointRef.current) return;
                const start = draggingStartPointRef.current;
                const newDraws = drawingsRef.current.map(d => {
                    if (d.id === draggingDrawingIdRef.current) {
                        if (d.type === 'horizontal') return { ...d, price: Number(p.toFixed(5)) };
                        if (d.type === 'vertical') return { ...d, time: getTimeFromLogX(lx) };
                        if (draggingHandleRef.current === 'start' || draggingHandleRef.current === 'end') {
                            const pt = { time: getTimeFromLogX(lx), price: Number(p.toFixed(5)) };
                            return (draggingHandleRef.current === 'start') ? { ...d, start: pt } : { ...d, end: pt };
                        } else {
                            const dx = lx - start.initialLogX, dy = start.initialPrice - p;
                            return { ...d, start: { time: getTimeFromLogX(start.initialStartLogX + dx), price: Number((start.initialStartPrice - dy).toFixed(5)) },
                                           end: { time: getTimeFromLogX(start.initialEndLogX + dx), price: Number((start.initialEndPrice - dy).toFixed(5)) } };
                        }
                    }
                    return d;
                });
                setDrawingsRef.current(newDraws);
            } else {
                // Hover cursor
                const hit = getHitDrawing(x, y);
                chartContainerRef.current.style.cursor = hit ? (hit.handle === 'line' ? 'pointer' : 'crosshair') : 'default';
            }
        };

        const handleUp = () => {
            setDraggingTrade(null); setDraggingDrawingId(null); setDraggingHandle(null);
            draggingTradeRef.current = null; draggingDrawingIdRef.current = null;
            chart.applyOptions({ handleScroll: true, handleScale: true });
            isDraggingRef.current = false;
        };

        const container = chartContainerRef.current;
        const onMouseDown = (e) => handleDown(e.clientX, e.clientY, e);
        const onMouseMove = (e) => handleMove(e.clientX, e.clientY);
        const onTouchStart = (e) => { if (e.touches.length) handleDown(e.touches[0].clientX, e.touches[0].clientY, e); };
        const onTouchMove = (e) => { if (e.touches.length) { if (isDraggingRef.current) e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); } };
        
        container.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', handleUp);
        container.addEventListener('touchstart', onTouchStart, {passive: false});
        window.addEventListener('touchmove', onTouchMove, {passive: false});
        window.addEventListener('touchend', handleUp);

        const resizeObserver = new ResizeObserver(entries => {
            if (!entries || !entries[0] || !chartRef.current) return;
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) {
                chartRef.current.applyOptions({ width, height });
                // Ao redimensionar, garante que o preço se ajuste se necessário
                chartRef.current.priceScale('right').applyOptions({ autoScale: true });
            }
        });
        
        // Dispara um resize manual inicial para garantir que o gráfico use o espaço disponível
        const initialWidth = container.clientWidth;
        const initialHeight = container.clientHeight;
        if (initialWidth > 0 && initialHeight > 0) {
            chart.applyOptions({ width: initialWidth, height: initialHeight });
        }
        resizeObserver.observe(container);

        return () => {
            container.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', handleUp);
            container.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', handleUp);
            chart.remove(); resizeObserver.disconnect();
        };
    }, [chartBgColor, showGrid, upCandleColor, downCandleColor, getTimeFromLogX, getLogicalIndexHover, getHitDrawing]);

    useEffect(() => {
        if (!chartRef.current || !seriesRef.current || !data || !data.length) return;
        
        // Converter tempos para números caso venham como string
        const validData = data.filter(d => isValidNumber(d.time)).map(d => ({
            ...d,
            time: Number(d.time)
        }));
        
        if (validData.length === 0) return;
        
        seriesRef.current.setData(validData);

        // --- AUTO SCALE LOGIC ---
        // We only force autoScale if follow is enabled AND the user isn't interacting
        if (isFollowEnabled) {
            // Note: We use a small timeout or check to see if data length is small
            if (data.length <= 200) {
                chartRef.current.timeScale().fitContent();
            }
            // Instead of force-resetting every time, we let it be automatic
            chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        }
    }, [data, isFollowEnabled]);

    useEffect(() => {
        if (!chartRef.current || !data || !data.length) return;

        // Limpar separadores antigos
        autoSeparatorSeriesRef.current.forEach(s => {
            try { chartRef.current.removeSeries(s); } catch (e) { }
        });
        autoSeparatorSeriesRef.current = [];

        const dayStarts = [];
        let lastDay = null;

        data.forEach(d => {
            const date = new Date((d.time + (timezoneOffset * 3600)) * 1000);
            const currentDay = date.getUTCDate();
            if (lastDay !== null && currentDay !== lastDay) {
                dayStarts.push(d.time);
            }
            lastDay = currentDay;
        });

        const style = separatorConfig.style === 'solid' ? LineStyle.Solid : separatorConfig.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed;

        dayStarts.forEach(time => {
            const s = chartRef.current.addSeries(LineSeries, {
                color: separatorConfig.color,
                lineWidth: separatorConfig.width,
                lineStyle: style,
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
                autoscaleInfoProvider: () => null,
            });
            // Usamos um intervalo enorme para garantir que cubra todo o gráfico (vertical)
            // Adicionamos +1 segundo ao segundo ponto para evitar erro de 'duplicate time' no Lightweight Charts
            s.setData([
                { time: time, value: -1000000 },
                { time: time + 1, value: 1000000 }
            ]);
            autoSeparatorSeriesRef.current.push(s);
        });

        return () => {
            autoSeparatorSeriesRef.current.forEach(s => {
                try { chartRef.current.removeSeries(s); } catch (e) { }
            });
            autoSeparatorSeriesRef.current = [];
        };
    }, [data, timezoneOffset, separatorConfig]);

    useLayoutEffect(() => {
        if (!chartRef.current || !seriesRef.current) return;
        drawingSeriesRef.current.forEach(item => {
            try { if (item.priceLine) seriesRef.current.removePriceLine(item.priceLine); else if (item.series) chartRef.current.removeSeries(item.series); } catch(e){}
        });
        drawingSeriesRef.current = [];
        drawings.forEach(draw => {
            const isSelected = draw.id === selectedDrawingId;
            const width = isSelected ? 4 : 2;
            const color = draw.color || '#58a6ff';
            
            if (draw.type === 'horizontal') {
                const line = seriesRef.current.createPriceLine({ price: draw.price, color, lineWidth: width, lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true });
                drawingSeriesRef.current.push({ id: draw.id, priceLine: line });
            } else if (draw.type === 'vertical') {
                const s = chartRef.current.addSeries(LineSeries, { color, lineWidth: width, lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Solid, crosshairMarkerVisible: true, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => null });
                const allPrices = dataRef.current.map(d => [d.high, d.low]).flat().filter(isValidNumber);
                if (allPrices.length) {
                    s.setData([{ time: draw.time, value: Math.min(...allPrices) * 0.5 }, { time: draw.time, value: Math.max(...allPrices) * 1.5 }]);
                    drawingSeriesRef.current.push({ id: draw.id, series: s });
                }
            } else if (draw.type === 'trend') {
                const s = chartRef.current.addSeries(LineSeries, { color, lineWidth: width, lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Solid, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => null });
                const slope = (draw.end.price - draw.start.price) / (draw.end.time - draw.start.time || 0.001);
                const intercept = draw.start.price - (slope * draw.start.time);
                const vData = dataRef.current;
                if (vData.length) {
                    s.setData([{ time: vData[0].time, value: slope * vData[0].time + intercept }, { time: vData[vData.length - 1].time, value: slope * vData[vData.length - 1].time + intercept }]);
                    drawingSeriesRef.current.push({ id: draw.id, series: s });
                    if (isSelected) {
                        s.setMarkers([{ time: draw.start.time, position: 'inBar', color: '#fff', shape: 'square', size: 8 },
                                      { time: (draw.start.time + draw.end.time) / 2, position: 'inBar', color: '#fff', shape: 'square', size: 8 },
                                      { time: draw.end.time, position: 'inBar', color: '#fff', shape: 'square', size: 8 }]);
                    }
                }
            } else if (draw.type === 'fib') {
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                const diff = draw.end.price - draw.start.price;
                const minT = Math.min(draw.start.time, draw.end.time);
                const vData = dataRef.current;
                levels.forEach(lvl => {
                    const s = chartRef.current.addSeries(LineSeries, { color: draw.color || (lvl === 0.5 ? 'rgba(248,81,73,0.6)' : 'rgba(139,148,158,0.6)'), lineWidth: isSelected ? 2 : 1, lineStyle: isSelected ? LineStyle.Dashed : LineStyle.Dotted, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => null });
                    const lvlPrice = draw.start.price + diff * lvl;
                    const fData = vData.filter(d => d.time >= minT).map(d => ({ time: d.time, value: lvlPrice }));
                    if (fData.length) {
                        s.setData(fData);
                        drawingSeriesRef.current.push({ id: draw.id, series: s });
                    }
                });
            }
        });

        // --- POSITION TRADE LINES ---
        positions.forEach(pos => {
            if (activeSymbol && pos.symbol.toUpperCase() !== activeSymbol.toUpperCase()) return;
            
            // Entry Line
            const entryLine = seriesRef.current.createPriceLine({
                price: pos.openPrice,
                color: pos.type === 'BUY' ? '#00cc88' : '#ff4444',
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: `${pos.type} ${pos.lots.toFixed(2)}`
            });
            drawingSeriesRef.current.push({ priceLine: entryLine });

            // SL Line
            if (pos.sl) {
                const slLine = seriesRef.current.createPriceLine({
                    price: pos.sl,
                    color: '#ff4444',
                    lineWidth: 2,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: `SL: ${pos.sl.toFixed(5)}`
                });
                drawingSeriesRef.current.push({ priceLine: slLine });
            }

            // TP Line
            if (pos.tp) {
                const tpLine = seriesRef.current.createPriceLine({
                    price: pos.tp,
                    color: '#00cc88',
                    lineWidth: 2,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: `TP: ${pos.tp.toFixed(5)}`
                });
                drawingSeriesRef.current.push({ priceLine: tpLine });
            }
        });
    }, [drawings, selectedDrawingId, positions, activeSymbol]);

    const handleCenter = () => { if (chartRef.current) { chartRef.current.timeScale().fitContent(); chartRef.current.priceScale('right').applyOptions({ autoScale: true }); } };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
            {activeTool && (
                <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-color)', padding: '5px 15px', borderRadius: '20px', fontSize: '0.8rem', color: 'white', zIndex: 1000 }}>
                    Tool Active: {activeTool.toUpperCase()} {pendingDrawing ? '(Click end point)' : '(Click start point)'}
                </div>
            )}
            {selectedDrawingId && (
                <button onClick={() => { setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId)); setSelectedDrawingId(null); }} style={{ position: 'absolute', top: '10px', right: '70px', background: '#ef5350', color: 'white', border: 'none', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer', zIndex: 1000 }}>
                    EXCLUIR [DEL]
                </button>
            )}
        </div>
    );
});

export default TradingChart;
