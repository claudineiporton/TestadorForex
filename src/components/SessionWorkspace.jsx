import React, { useState, useRef } from 'react';
import '../App.css';
import { useSessionEngine } from '../engine/useSessionEngine';
import { SYMBOLS } from '../engine/config';
import { saveHistoricalData, clearHistoricalData } from '../engine/storage';
import TradingChart from './TradingChart';

export default function SessionWorkspace({ sessionConfig, onSaveSession, onEndSession, onNewSession, currentUser, onLogout }) {
    const {
        balance,
        equity,
        positions,
        history,
        bidPrices,
        askPrices,
        candlesMap,
        activeSymbol,
        setActiveSymbol,
        isRunning,
        setIsRunning,
        speed,
        setSpeed,
        simulatedTime,
        timeframe,
        setTimeframe,
        openPosition,
        updatePosition,
        closePosition,
        isLoadingData
    } = useSessionEngine(sessionConfig, onSaveSession);

    // Derive current values for the active tab
    const currentPrice = bidPrices[activeSymbol];
    const askPrice = askPrices[activeSymbol];
    const candles = candlesMap[activeSymbol] || [];

    const [editingPosition, setEditingPosition] = useState(null);

    const [lotSize, setLotSize] = useState(0.1);
    const [sl, setSl] = useState('');
    const [tp, setTp] = useState('');
    const [activeTool, setActiveTool] = useState(null);
    const [selectedColor, setSelectedColor] = useState('#58a6ff');
    const [sepColor, setSepColor] = useState('#000000');
    const [sepWidth, setSepWidth] = useState(1);
    const [sepStyle, setSepStyle] = useState('dashed');
    const [showSettings, setShowSettings] = useState(false);
    const [indicators, setIndicators] = useState([]);
    const [activeBottomTab, setActiveBottomTab] = useState('Trade');

    // Need to store drawings per symbol ideally, but for now we keep it simple
    const [drawingsMap, setDrawingsMap] = useState({});
    const drawings = drawingsMap[activeSymbol] || [];
    const setDrawings = (newDrawings) => {
        setDrawingsMap(prevMap => {
            const currentDrawings = prevMap[activeSymbol] || [];
            const updatedDrawings = typeof newDrawings === 'function' ? newDrawings(currentDrawings) : newDrawings;
            return { ...prevMap, [activeSymbol]: updatedDrawings };
        });
    };

    const [timezoneOffset, setTimezoneOffset] = useState(-3);
    const [isFollowEnabled, setIsFollowEnabled] = useState(true);
    const chartRef = useRef(null);

    const [chartBgColor, setChartBgColor] = useState('#ffffff');
    const [showGrid, setShowGrid] = useState(false);
    const [upCandleColor, setUpCandleColor] = useState('#26a69a');
    const [downCandleColor, setDownCandleColor] = useState('#ef5350');

    const handleStartSimulation = () => {
        if (balance < 10) {
            alert("O saldo não é suficiente para continuar.");
            return;
        }
        setIsRunning(!isRunning);
    };

    const handleImportCSV = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        let targetSymbol = activeSymbol;
        const upperName = file.name.toUpperCase();
        const foundSyms = Object.keys(SYMBOLS).filter(s => upperName.includes(s));

        if (foundSyms.length > 0) {
            targetSymbol = foundSyms[0];
        } else {
            const userInput = prompt(`Não foi possível identificar o par no nome do arquivo "${file.name}".\nPara qual par de moedas você deseja importar?`, activeSymbol);
            if (!userInput) {
                event.target.value = '';
                return;
            }
            targetSymbol = userInput.toUpperCase().trim();
        }

        if (!SYMBOLS[targetSymbol]) {
            alert(`Símbolo ${targetSymbol} não encontrado na configuração. Operação cancelada.`);
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                const lines = text.split('\n');
                const parsedCandles = [];
                const timeframe = 60; // default M1

                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const separator = line.includes('\t') ? '\t' : ',';
                    const parts = line.split(separator);

                    if (parts.length >= 6) {
                        const dateRaw = parts[0].replace(/\//g, '.').replace(/-/g, '.');
                        const dateParts = dateRaw.split('.');
                        let year, month, day;

                        if (dateParts[0].length === 4) {
                            // YYYY.MM.DD
                            year = dateParts[0];
                            month = dateParts[1];
                            day = dateParts[2];
                        } else {
                            // Assume DD.MM.YYYY (very common in Brazil or excel exports)
                            day = dateParts[0];
                            month = dateParts[1];
                            year = dateParts[2];
                        }

                        const timeStr = parts[1].length === 5 ? `${parts[1]}:00` : parts[1];

                        // Safely parse numbers: handle Brazilian locale where comma is decimal separator
                        const parseNumber = (str) => {
                            if (!str) return 0;
                            let s = str.trim();
                            // If it contains a comma and NO period, or comma comes after period
                            if (s.includes(',') && !s.includes('.')) {
                                s = s.replace(',', '.');
                            } else if (s.includes(',') && s.includes('.')) {
                                // e.g. 1.000,50
                                if (s.indexOf(',') > s.indexOf('.')) {
                                    s = s.replace(/\./g, '').replace(',', '.');
                                } else { // e.g. 1,000.50
                                    s = s.replace(/,/g, '');
                                }
                            }
                            return parseFloat(s);
                        };

                        const o = parseNumber(parts[2]);
                        const h = parseNumber(parts[3]);
                        const l = parseNumber(parts[4]);
                        const c = parseNumber(parts[5]);
                        const v = parts.length >= 7 ? parseNumber(parts[6]) : 0;

                        const datetimeStr = `${year}-${month}-${day}T${timeStr}Z`;
                        const dateObj = new Date(datetimeStr);

                        if (!isNaN(dateObj.getTime()) && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c)) {
                            parsedCandles.push({
                                time: Math.floor(dateObj.getTime() / 1000),
                                open: o, high: h, low: l, close: c, volume: v
                            });
                        }
                    }
                }

                if (parsedCandles.length > 0) {
                    const shouldClear = window.confirm(`Deseja substituir (apagar) os dados antigos de ${targetSymbol} antes de importar os novos?\n\nOK = Substituir tudo\nCancelar = Apenas adicionar (mesclar)`);
                    if (shouldClear) {
                        await clearHistoricalData(targetSymbol, timeframe);
                    }
                    await saveHistoricalData(targetSymbol, timeframe, parsedCandles);
                    alert(`Importação concluída! ${parsedCandles.length} candles salvos para ${targetSymbol}.`);
                } else {
                    alert("Nenhum dado válido encontrado no arquivo CSV.");
                }
            } catch (error) {
                console.error(error);
                alert("Falha ao importar o arquivo CSV.");
            }
        };
        reader.onerror = () => alert("Falha ao ler o arquivo.");
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    };

    const colors = [
        { name: 'Blue', value: '#58a6ff' },
        { name: 'Yellow', value: '#F2C94C' },
        { name: 'Red', value: '#EB5757' },
        { name: 'Green', value: '#27AE60' },
        { name: 'White', value: '#FFFFFF' }
    ];

    const timeframes = [
        { label: 'M1', value: 60 },
        { label: 'M5', value: 300 },
        { label: 'M15', value: 900 },
        { label: 'M30', value: 1800 },
        { label: 'H1', value: 3600 },
        { label: 'H4', value: 14400 },
        { label: 'D1', value: 86400 },
    ];

    const symbolConfig = SYMBOLS[activeSymbol];

    const addIndicator = (type) => {
        const period = prompt("Periodo:", "14");
        if (period) {
            setIndicators([...indicators, {
                id: Date.now(),
                type,
                period: Number(period),
                color: type === 'SMA' ? '#f2c94c' : '#bb6bd9'
            }]);
        }
    };

    const removeIndicator = (id) => {
        setIndicators(indicators.filter(i => i.id !== id));
    };

    const calculatePriceFromPoints = (type, ptsInput) => {
        if (!ptsInput || isNaN(ptsInput) || !currentPrice) return null;
        const pts = Number(ptsInput);
        if (pts <= 0) return null;
        const tick = symbolConfig?.tickSize || 0.00001;
        const dist = pts * tick;
        if (type === 'BUY') {
            return { sl: currentPrice - dist, tp: currentPrice + dist };
        } else {
            return { sl: currentPrice + dist, tp: currentPrice - dist };
        }
    };

    return (
        <div className="app-container">
            <header className="header" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 15px' }}>
                <div className="logo-section">
                    <h1 style={{ fontSize: '1.2rem', margin: 0 }}>
                        ForexSim <span style={{ color: 'var(--accent-color)', fontSize: '0.7rem' }}>PRO</span>
                        <span style={{ fontSize: '0.7rem', color: '#8b949e', marginLeft: '10px', fontWeight: 'normal' }}>
                            Sessão: {sessionConfig.name}
                        </span>
                    </h1>
                    {simulatedTime !== null && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                            {new Date((Number(simulatedTime) + (Number(timezoneOffset) * 3600)) * 1000).toISOString().replace('T', ' ').substring(0, 16)}
                        </div>
                    )}
                </div>

                <div className="controls" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '4px', background: '#21262d', padding: '2px 5px', borderRadius: '4px', border: '1px solid #30363d' }}>
                        <button onClick={() => setActiveTool(activeTool === 'horizontal' ? null : 'horizontal')} style={{ background: activeTool === 'horizontal' ? 'var(--accent-color)' : 'transparent', width: '28px', padding: '2px 0', border: 'none', color: 'white', fontWeight: 'bold' }}>—</button>
                        <button onClick={() => setActiveTool(activeTool === 'vertical' ? null : 'vertical')} style={{ background: activeTool === 'vertical' ? 'var(--accent-color)' : 'transparent', width: '28px', padding: '2px 0', border: 'none', color: 'white', fontWeight: 'bold' }}>|</button>
                        <button onClick={() => setActiveTool(activeTool === 'trend' ? null : 'trend')} style={{ background: activeTool === 'trend' ? 'var(--accent-color)' : 'transparent', width: '28px', padding: '2px 0', border: 'none', color: 'white', fontWeight: 'bold' }}>╱</button>
                    </div>

                    <div style={{ display: 'flex', gap: '4px', background: '#21262d', padding: '4px 6px', borderRadius: '4px', border: '1px solid #30363d' }}>
                        {colors.map(col => (
                            <div key={col.value} onClick={() => setSelectedColor(col.value)} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: col.value, cursor: 'pointer', border: selectedColor === col.value ? '1px solid white' : '1px solid transparent' }} />
                        ))}
                    </div>

                    <select value={timezoneOffset} onChange={(e) => setTimezoneOffset(Number(e.target.value))} style={{ width: '80px', padding: '2px', fontSize: '0.65rem', background: '#21262d', color: 'white', border: '1px solid #30363d', borderRadius: '4px' }}>
                        <option value="0">UTC (0)</option>
                        <option value="-3">UTC -3 (BR)</option>
                    </select>

                    <div style={{ display: 'flex', gap: '2px', background: '#21262d', padding: '2px', borderRadius: '4px', border: '1px solid #30363d' }}>
                        {timeframes.map(tf => (
                            <button key={tf.value} onClick={() => setTimeframe(tf.value)} style={{ padding: '2px 5px', borderRadius: '3px', border: 'none', fontSize: '0.6rem', fontWeight: 'bold', cursor: 'pointer', backgroundColor: timeframe === tf.value ? 'var(--accent-color)' : 'transparent', color: timeframe === tf.value ? 'white' : 'var(--text-secondary)' }}>
                                {tf.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: '55px', padding: '2px', fontSize: '0.7rem' }}>
                            <option value="1">1x</option>
                            <option value="2">2x</option>
                            <option value="5">5x</option>
                            <option value="10">10x</option>
                        </select>
                        {isLoadingData ? (
                            <span style={{ fontSize: '0.65rem', color: 'var(--success-color)' }}>Baixando Gráfico...</span>
                        ) : null}
                        <button onClick={handleStartSimulation} disabled={isLoadingData} style={{ width: '80px', background: isRunning ? 'var(--error-color)' : 'var(--accent-color)', fontSize: '0.7rem', height: '28px', marginTop: 0, opacity: isLoadingData ? 0.5 : 1, fontWeight: 'bold' }}>
                            {isRunning ? 'PAUSE' : 'START'}
                        </button>
                        <button onClick={onEndSession} style={{ padding: '4px 8px', background: '#21262d', border: '1px solid #30363d', color: 'white', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer' }}>
                            X Fechar
                        </button>
                    </div>
                </div>
            </header>

            <aside className="sidebar">
                <div className="mt5-sidebar-section" style={{ marginBottom: '15px' }}>
                    <button onClick={onNewSession} style={{ width: '100%', padding: '10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '1.2rem', lineHeight: '1' }}>+</span> Nova Sessão
                    </button>
                </div>
                <div className="mt5-sidebar-section">
                    <div className="mt5-sidebar-header">Navigator</div>
                    <div className="mt5-list-item" onClick={() => setShowSettings(!showSettings)}>⚙️ Chart Properties</div>

                    <label className="mt5-list-item" style={{ cursor: 'pointer', display: 'block' }}>
                        📥 Importar Histórico CSV
                        <input type="file" accept=".csv" onChange={handleImportCSV} style={{ display: 'none' }} />
                    </label>

                    <div className="mt5-list-item">
                        📊 Indicators
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
                            <button onClick={() => addIndicator('SMA')} style={{ padding: '2px 4px', fontSize: '0.65rem', width: 'auto', marginTop: 0 }}>+SMA</button>
                        </div>
                    </div>
                    <div className="indicators-list">
                        {indicators.map(ind => (
                            <div key={ind.id} className="indicator-tag">
                                {ind.type}({ind.period})
                                <span className="indicator-remove" onClick={() => removeIndicator(ind.id)}>×</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt5-sidebar-section" style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                        <button onClick={() => chartRef.current?.center()} style={{ flex: 1, padding: '8px', background: '#21262d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>CENTER</button>
                        <button onClick={() => setIsFollowEnabled(!isFollowEnabled)} style={{ flex: 1, padding: '8px', background: isFollowEnabled ? 'var(--accent-color)' : '#21262d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>{isFollowEnabled ? 'FOLLOWING' : 'FOLLOW'}</button>
                    </div>
                    {drawings.length > 0 && (
                        <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button onClick={() => setDrawings(prev => prev.slice(0, -1))} style={{ flex: 1, padding: '6px', background: '#21262d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.7rem' }}>UNDO DRAWING</button>
                            <button onClick={() => setDrawings([])} style={{ flex: 1, padding: '6px', background: '#21262d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.7rem' }}>CLEAR DRAWINGS</button>
                        </div>
                    )}
                    <div className="mt5-one-click-panel" style={{ position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', transform: 'none', boxShadow: 'none', background: 'transparent', padding: 0, border: 'none', width: '100%', justifyContent: 'center', marginTop: '5px' }}>
                        <div className="mt5-btn sell" onClick={() => {
                            const targets = calculatePriceFromPoints('SELL', sl) || {};
                            openPosition('SELL', lotSize, targets.sl, targets.tp);
                        }}>
                            <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>SELL</span>
                            <span>{currentPrice?.toFixed(symbolConfig?.digits || 5)}</span>
                        </div>
                        <input type="number" min="0" className="mt5-lot-selector" value={lotSize} step="0.01" onChange={(e) => setLotSize(Math.max(0, Number(e.target.value)))} onClick={(e) => e.stopPropagation()} />
                        <div className="mt5-btn buy" onClick={() => {
                            const targets = calculatePriceFromPoints('BUY', sl) || {};
                            openPosition('BUY', lotSize, targets.sl, targets.tp);
                        }}>
                            <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>BUY</span>
                            <span>{askPrice?.toFixed(symbolConfig?.digits || 5)}</span>
                        </div>
                    </div>
                </div>

                <div className="card" style={{ padding: '10px', marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #30363d' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.65rem', color: '#8b949e' }}>Logged in as</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{currentUser?.email?.split('@')[0]}</span>
                        </div>
                        <button onClick={onLogout} style={{ padding: '4px 8px', background: 'transparent', color: '#ef5350', border: '1px solid #ef5350', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer' }}>
                            Sair
                        </button>
                    </div>

                    <h3 style={{ fontSize: '0.8rem' }}>Account</h3>
                    <div style={{ marginTop: '10px' }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Balance ($):</label>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold', textAlign: 'right', marginTop: '2px' }}>
                            ${balance.toFixed(2)}
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: '8px' }}>
                        <span>Equity:</span>
                        <span style={{ color: equity >= balance ? 'var(--success-color)' : 'var(--error-color)', fontWeight: 'bold' }}>${equity.toFixed(2)}</span>
                    </div>
                </div>
            </aside>

            <main className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>

                <div style={{ position: 'relative', flex: 1 }}>
                    <TradingChart
                        ref={chartRef}
                        data={candles}
                        askPrice={askPrice}
                        positions={positions.filter(p => p.symbol === activeSymbol)}
                        activeSymbol={activeSymbol}
                        activeTool={activeTool}
                        activeColor={selectedColor}
                        onToolComplete={() => setActiveTool(null)}
                        onUpdatePosition={updatePosition}
                        separatorConfig={{ color: sepColor, width: sepWidth, style: sepStyle }}
                        drawings={drawings}
                        setDrawings={setDrawings}
                        timeframe={timeframe}
                        timezoneOffset={timezoneOffset}
                        chartBgColor={chartBgColor}
                        showGrid={showGrid}
                        upCandleColor={upCandleColor}
                        downCandleColor={downCandleColor}
                        indicators={indicators}
                        isFollowEnabled={isFollowEnabled}
                    />
                </div>

                {/* TAB BAR FOR MULTIPLE CHARTS (MOVED TO BOTTOM) */}
                <div style={{ display: 'flex', background: '#0d1117', borderTop: '1px solid #30363d' }}>
                    {sessionConfig.selectedPairs.map(symbol => (
                        <div
                            key={symbol}
                            onClick={() => setActiveSymbol(symbol)}
                            style={{
                                padding: '8px 20px',
                                fontSize: '0.8rem',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                background: activeSymbol === symbol ? '#161b22' : 'transparent',
                                borderRight: '1px solid #30363d',
                                color: activeSymbol === symbol ? 'var(--accent-color)' : '#8b949e',
                                borderBottom: activeSymbol === symbol ? '2px solid var(--accent-color)' : '2px solid transparent'
                            }}
                        >
                            {symbol}
                            {bidPrices[symbol] && (
                                <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: 'white', fontWeight: 'normal' }}>
                                    {bidPrices[symbol].toFixed(SYMBOLS[symbol]?.digits || 5)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {showSettings && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#161b22', border: '1px solid #30363d', padding: '20px', borderRadius: '8px', zIndex: 1000, width: '300px', boxShadow: '0 0 40px rgba(0,0,0,0.8)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem' }}>Properties</h3>
                            <span style={{ cursor: 'pointer', fontSize: '1.2rem' }} onClick={() => setShowSettings(false)}>×</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {/* Simplified settings for brevity */}
                            <button onClick={() => setShowSettings(false)} style={{ padding: '10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px' }}>APPLICAR</button>
                        </div>
                    </div>
                )}
            </main>

            <footer className="footer" style={{ borderTop: '1px solid #30363d', background: '#0d1117', padding: 0 }}>
                <div style={{ display: 'flex', gap: '2px', background: '#21262d', padding: '2px 2px 0 2px' }}>
                    {['Trade', 'History'].map(tab => (
                        <span key={tab} onClick={() => setActiveBottomTab(tab)} style={{ cursor: 'pointer', padding: '6px 15px', fontSize: '0.7rem', fontWeight: 'bold', borderRadius: '3px 3px 0 0', background: activeBottomTab === tab ? '#0d1117' : 'transparent', color: activeBottomTab === tab ? 'white' : '#8b949e', border: activeBottomTab === tab ? '1px solid #30363d' : '1px solid transparent', borderBottom: activeBottomTab === tab ? '1px solid #0d1117' : '1px solid #30363d', zIndex: activeBottomTab === tab ? 2 : 1 }}>
                            {tab}
                        </span>
                    ))}
                    <div style={{ flex: 1, borderBottom: '1px solid #30363d' }}></div>
                </div>

                <div style={{ padding: '10px', overflowY: 'auto', height: '140px' }}>
                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                        <thead>
                            <tr style={{ color: '#8b949e', borderBottom: '1px solid #30363d' }}>
                                {activeBottomTab === 'Trade' ? (
                                    <>
                                        <th style={{ padding: '4px' }}>Symbol</th>
                                        <th style={{ padding: '4px' }}>Type</th>
                                        <th style={{ padding: '4px' }}>Size</th>
                                        <th style={{ padding: '4px' }}>Price</th>
                                        <th style={{ padding: '4px' }}>Current</th>
                                        <th style={{ padding: '4px' }}>P/L</th>
                                        <th style={{ padding: '4px' }}>Action</th>
                                    </>
                                ) : (
                                    <>
                                        <th style={{ padding: '4px' }}>Symbol</th>
                                        <th style={{ padding: '4px' }}>Type</th>
                                        <th style={{ padding: '4px' }}>Size</th>
                                        <th style={{ padding: '4px' }}>Open</th>
                                        <th style={{ padding: '4px' }}>Close</th>
                                        <th style={{ padding: '4px' }}>P/L</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {activeBottomTab === 'Trade' ? (
                                positions.map(p => {
                                    const symCurrent = bidPrices[p.symbol] || currentPrice;
                                    const symAsk = askPrices[p.symbol] || askPrice;
                                    const closePrice = p.type === 'BUY' ? symCurrent : symAsk;
                                    const pnl = (closePrice - p.openPrice) * (p.type === 'BUY' ? 1 : -1) * (SYMBOLS[p.symbol]?.lotSize || 100000) * p.lots;
                                    const posDigits = SYMBOLS[p.symbol]?.digits || 5;

                                    return (
                                        <tr key={p.id} style={{ borderBottom: '1px solid #21262d' }}>
                                            <td style={{ padding: '4px' }}>{p.symbol}</td>
                                            <td style={{ padding: '4px', color: p.type === 'BUY' ? 'var(--success-color)' : 'var(--error-color)' }}>{p.type}</td>
                                            <td style={{ padding: '4px' }}>{p.lots.toFixed(2)}</td>
                                            <td style={{ padding: '4px' }}>{p.openPrice.toFixed(posDigits)}</td>
                                            <td style={{ padding: '4px' }}>{closePrice?.toFixed(posDigits)}</td>
                                            <td style={{ padding: '4px', fontWeight: 'bold', color: pnl >= 0 ? 'var(--success-color)' : 'var(--error-color)' }}>{pnl.toFixed(2)}</td>
                                            <td style={{ padding: '4px', display: 'flex', gap: '5px' }}>
                                                <button onClick={() => setEditingPosition(p)} style={{ width: 'auto', padding: '2px 6px', fontSize: '0.6rem', marginTop: 0, background: '#21262d' }}>Modify</button>
                                                <button onClick={() => closePosition(p.id)} style={{ width: 'auto', padding: '2px 6px', fontSize: '0.6rem', marginTop: 0 }}>Close</button>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                history.map((h, i) => {
                                    const posDigits = SYMBOLS[h.symbol]?.digits || 5;
                                    return (
                                        <tr key={i} style={{ borderBottom: '1px solid #21262d', color: '#8b949e' }}>
                                            <td style={{ padding: '4px' }}>{h.symbol}</td>
                                            <td style={{ padding: '4px', color: h.type === 'BUY' ? 'var(--success-color)' : 'var(--error-color)', opacity: 0.8 }}>{h.type}</td>
                                            <td style={{ padding: '4px' }}>{h.lots.toFixed(2)}</td>
                                            <td style={{ padding: '4px' }}>{h.openPrice.toFixed(posDigits)}</td>
                                            <td style={{ padding: '4px' }}>{h.closePrice.toFixed(posDigits)}</td>
                                            <td style={{ padding: '4px', fontWeight: 'bold', color: h.pnl >= 0 ? 'var(--success-color)' : 'var(--error-color)' }}>{h.pnl.toFixed(2)}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </footer>

            {/* --- MODIFY POSITION MODAL --- */}
            {editingPosition && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', width: '320px' }}>
                        <h3 style={{ marginTop: 0, fontSize: '1rem', borderBottom: '1px solid #30363d', paddingBottom: '10px' }}>Modify Order #{editingPosition.id.toString().slice(-6)}</h3>
                        <div style={{ padding: '10px 0', fontSize: '0.75rem', color: '#8b949e' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                <span>Type:</span> <span style={{ color: editingPosition.type === 'BUY' ? 'var(--success-color)' : 'var(--error-color)', fontWeight: 'bold' }}>{editingPosition.type}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Entry Price:</span> <span style={{ color: 'white' }}>{editingPosition.openPrice.toFixed(5)}</span>
                            </div>
                        </div>

                        <div style={{ padding: '15px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* STOP LOSS SECTION */}
                            <div style={{ borderLeft: '2px solid var(--error-color)', paddingLeft: '10px' }}>
                                <label style={{ fontSize: '0.75rem', color: '#8b949e', display: 'block', marginBottom: '8px' }}>STOP LOSS (SL)</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.6rem', color: '#8b949e', display: 'block' }}>Price</label>
                                        <input
                                            type="number" step="0.00001" placeholder="0.00000"
                                            value={editingPosition.sl === null || editingPosition.sl === undefined ? '' : editingPosition.sl}
                                            onChange={(e) => setEditingPosition({ ...editingPosition, sl: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                            style={{ width: '100%', padding: '8px', background: '#0d1117', border: '1px solid #30363d', color: 'white', borderRadius: '4px' }}
                                        />
                                    </div>
                                    <div style={{ width: '100px' }}>
                                        <label style={{ fontSize: '0.6rem', color: '#8b949e', display: 'block' }}>Points</label>
                                        <input
                                            type="number" placeholder="Distance"
                                            value={
                                                editingPosition.sl
                                                    ? (Math.abs(editingPosition.openPrice - editingPosition.sl) / (SYMBOLS[editingPosition.symbol]?.tickSize || 0.00001)).toFixed(0)
                                                    : ''
                                            }
                                            onChange={(e) => {
                                                if (e.target.value === '') {
                                                    setEditingPosition({ ...editingPosition, sl: null });
                                                    return;
                                                }
                                                const pts = parseFloat(e.target.value);
                                                if (!isNaN(pts)) {
                                                    const tick = SYMBOLS[editingPosition.symbol]?.tickSize || 0.00001;
                                                    const dist = pts * tick;
                                                    const newSl = editingPosition.type === 'BUY' ? editingPosition.openPrice - dist : editingPosition.openPrice + dist;
                                                    setEditingPosition({ ...editingPosition, sl: Number(newSl.toFixed(5)) });
                                                }
                                            }}
                                            style={{ width: '100%', padding: '8px', background: '#0d1117', border: '1px solid #30363d', color: '#8b949e', borderRadius: '4px' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* TAKE PROFIT SECTION */}
                            <div style={{ borderLeft: '2px solid var(--success-color)', paddingLeft: '10px' }}>
                                <label style={{ fontSize: '0.75rem', color: '#8b949e', display: 'block', marginBottom: '8px' }}>TAKE PROFIT (TP)</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.6rem', color: '#8b949e', display: 'block' }}>Price</label>
                                        <input
                                            type="number" step="0.00001" placeholder="0.00000"
                                            value={editingPosition.tp === null || editingPosition.tp === undefined ? '' : editingPosition.tp}
                                            onChange={(e) => setEditingPosition({ ...editingPosition, tp: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                            style={{ width: '100%', padding: '8px', background: '#0d1117', border: '1px solid #30363d', color: 'white', borderRadius: '4px' }}
                                        />
                                    </div>
                                    <div style={{ width: '100px' }}>
                                        <label style={{ fontSize: '0.6rem', color: '#8b949e', display: 'block' }}>Points</label>
                                        <input
                                            type="number" placeholder="Distance"
                                            value={
                                                editingPosition.tp
                                                    ? (Math.abs(editingPosition.openPrice - editingPosition.tp) / (SYMBOLS[editingPosition.symbol]?.tickSize || 0.00001)).toFixed(0)
                                                    : ''
                                            }
                                            onChange={(e) => {
                                                if (e.target.value === '') {
                                                    setEditingPosition({ ...editingPosition, tp: null });
                                                    return;
                                                }
                                                const pts = parseFloat(e.target.value);
                                                if (!isNaN(pts)) {
                                                    const tick = SYMBOLS[editingPosition.symbol]?.tickSize || 0.00001;
                                                    const dist = pts * tick;
                                                    const newTp = editingPosition.type === 'BUY' ? editingPosition.openPrice + dist : editingPosition.openPrice - dist;
                                                    setEditingPosition({ ...editingPosition, tp: Number(newTp.toFixed(5)) });
                                                }
                                            }}
                                            style={{ width: '100%', padding: '8px', background: '#0d1117', border: '1px solid #30363d', color: '#8b949e', borderRadius: '4px' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                            <button
                                onClick={() => {
                                    updatePosition(editingPosition.id, {
                                        sl: editingPosition.sl,
                                        tp: editingPosition.tp
                                    });
                                    setEditingPosition(null);
                                }}
                                style={{ flex: 1, padding: '12px', fontSize: '0.8rem', background: 'var(--accent-color)', borderRadius: '4px', fontWeight: 'bold' }}
                            >
                                MODIFY ORDER
                            </button>
                            <button
                                onClick={() => setEditingPosition(null)}
                                style={{ flex: 1, padding: '12px', fontSize: '0.8rem', background: '#21262d', border: '1px solid #30363d', borderRadius: '4px' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
