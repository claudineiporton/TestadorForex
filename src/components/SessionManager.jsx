import React, { useState, useEffect } from 'react';
import { SYMBOLS } from '../engine/config';
import { saveHistoricalData, clearHistoricalData } from '../engine/storage';
import './SessionManager.css'; 

export default function SessionManager({ onSelectSession, onClose }) {
    const [sessions, setSessions] = useState([]);
    const [isCreating, setIsCreating] = useState(false);

    // Form State
    const [sessionName, setSessionName] = useState('');
    const [initialBalance, setInitialBalance] = useState(10000);
    const [selectedPairs, setSelectedPairs] = useState(['EURUSD']);

    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const [startDate, setStartDate] = useState(defaultStart.toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

    useEffect(() => {
        const saved = localStorage.getItem('forex_sim_sessions');
        if (saved) {
            try {
                setSessions(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse sessions", e);
            }
        }
    }, []);

    const handleCreate = (e) => {
        e.preventDefault();
        if (!sessionName.trim()) {
            alert("Informe o nome da sessão");
            return;
        }
        if (selectedPairs.length === 0) {
            alert("Selecione pelo menos um par de moedas");
            return;
        }

        const newSession = {
            id: Date.now().toString(),
            name: sessionName,
            initialBalance: Number(initialBalance),
            currentBalance: Number(initialBalance),
            selectedPairs,
            startDate,
            endDate,
            positions: [],
            history: [],
            timeframe: 60, // default M1
            createdAt: new Date().toISOString()
        };

        const updated = [...sessions, newSession];
        setSessions(updated);
        localStorage.setItem('forex_sim_sessions', JSON.stringify(updated));
        setIsCreating(false);

        // Reset form
        setSessionName('');
        setSelectedPairs(['EURUSD']);
    };

    const handleDelete = (id, e) => {
        e.stopPropagation();
        if (window.confirm("Deseja realmente excluir esta sessão? Todo o progresso será perdido.")) {
            const updated = sessions.filter(s => s.id !== id);
            setSessions(updated);
            localStorage.setItem('forex_sim_sessions', JSON.stringify(updated));
        }
    };

    const togglePair = (symbol) => {
        if (selectedPairs.includes(symbol)) {
            setSelectedPairs(selectedPairs.filter(s => s !== symbol));
        } else {
            setSelectedPairs([...selectedPairs, symbol]);
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', color: 'white', fontFamily: 'sans-serif', background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', position: 'relative' }}>
            {onClose && (
                <button onClick={onClose} style={{ position: 'absolute', top: '15px', right: '20px', background: 'transparent', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
            )}
            <h1 style={{ textAlign: 'center', color: 'var(--accent-color)', marginTop: '0' }}>Gerenciador de Sessões</h1>

            {!isCreating ? (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h2 style={{ fontSize: '1.1rem' }}>Suas Sessões</h2>
                        <button onClick={() => setIsCreating(true)} style={{ padding: '8px 15px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                            + Nova Sessão
                        </button>
                    </div>

                    {sessions.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#8b949e', marginTop: '50px', marginBottom: '30px' }}>
                            Nenhuma sessão encontrada. Crie uma nova para começar.
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px', maxHeight: 'max(400px, 60vh)', overflowY: 'auto', paddingRight: '5px' }}>
                            {sessions.map(s => (
                                <div
                                    key={s.id}
                                    onClick={() => onSelectSession(s)}
                                    style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '15px', cursor: 'pointer', transition: 'transform 0.2s', position: 'relative' }}
                                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <button
                                        onClick={(e) => handleDelete(s.id, e)}
                                        style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: '#ef5350', cursor: 'pointer', fontSize: '1.2rem' }}
                                        title="Excluir"
                                    >×</button>
                                    <h3 style={{ marginTop: 0, color: 'var(--accent-color)', fontSize: '1rem', paddingRight: '15px' }}>{s.name}</h3>
                                    <div style={{ fontSize: '0.8rem', color: '#8b949e', marginBottom: '10px' }}>
                                        Criada: {new Date(s.createdAt).toLocaleDateString()}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '0.85rem' }}>
                                        <span>Saldo Atual:</span>
                                        <span style={{ fontWeight: 'bold', color: 'white' }}>${s.currentBalance.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.85rem' }}>
                                        <span>Posições Abertas:</span>
                                        <span>{s.positions?.length || 0}</span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <strong>Pares:</strong> {s.selectedPairs.join(', ')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '15px' }}>Criar Nova Sessão</h2>
                    <form onSubmit={handleCreate}>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem' }}>Nome da Sessão</label>
                            <input type="text" required value={sessionName} onChange={e => setSessionName(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #30363d', background: '#161b22', color: 'white' }} placeholder="Ex: Backtest EURUSD/GBPUSD" />
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem' }}>Saldo Inicial ($)</label>
                            <input type="number" required min="10" value={initialBalance} onChange={e => setInitialBalance(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #30363d', background: '#161b22', color: 'white' }} />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem' }}>Data Inicial (Simulação)</label>
                                <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #30363d', background: '#161b22', color: 'white' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem' }}>Data Final</label>
                                <input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #30363d', background: '#161b22', color: 'white' }} />
                            </div>
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.85rem' }}>Pares de Moeda (Selecione 1 ou mais)</label>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', maxHeight: '120px', overflowY: 'auto', padding: '10px', background: '#161b22', border: '1px solid #30363d', borderRadius: '4px' }}>
                                {Object.keys(SYMBOLS).map(symbol => (
                                    <div
                                        key={symbol}
                                        onClick={() => togglePair(symbol)}
                                        style={{
                                            padding: '4px 10px',
                                            borderRadius: '15px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            border: selectedPairs.includes(symbol) ? '1px solid var(--accent-color)' : '1px solid #30363d',
                                            background: selectedPairs.includes(symbol) ? 'rgba(88, 166, 255, 0.2)' : 'transparent',
                                            color: selectedPairs.includes(symbol) ? 'white' : '#8b949e'
                                        }}
                                    >
                                        {symbol}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--accent-color)' }}>
                                📥 Importar Dados Históricos (Opcional)
                            </label>
                            <p style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: '10px' }}>
                                Use arquivos CSV (MT5/Yahoo) para carregar o histórico no celular.
                            </p>
                            <label style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                gap: '10px',
                                padding: '12px', 
                                background: '#21262d', 
                                border: '1px dashed #30363d', 
                                borderRadius: '8px', 
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                color: 'white',
                                transition: 'background 0.2s'
                            }}>
                                📁 Selecionar Arquivo CSV
                                <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => {
                                    const file = e.target.files[0];
                                    if (!file) return;
                                    
                                    const reader = new FileReader();
                                    reader.onload = async (evt) => {
                                        try {
                                            const text = evt.target.result;
                                            const lines = text.split('\n');
                                            const parsedCandles = [];
                                            const timeframe = 60; // default M1

                                            // Determine target symbol automatically from filename
                                            let targetSymbol = selectedPairs[0] || 'EURUSD';
                                            const upperName = file.name.toUpperCase();
                                            const foundSyms = Object.keys(SYMBOLS).filter(s => upperName.includes(s));
                                            if (foundSyms.length > 0) targetSymbol = foundSyms[0];

                                            for (let i = 1; i < lines.length; i++) {
                                                const line = lines[i].trim();
                                                if (!line) continue;
                                                const parts = line.split(line.includes('\t') ? '\t' : ',');
                                                if (parts.length >= 6) {
                                                    // Simple parse logic for the manager
                                                    const o = parseFloat(parts[2].replace(',', '.'));
                                                    const h = parseFloat(parts[3].replace(',', '.'));
                                                    const l = parseFloat(parts[4].replace(',', '.'));
                                                    const c = parseFloat(parts[5].replace(',', '.'));
                                                    if (!isNaN(o) && !isNaN(c)) {
                                                        parsedCandles.push({
                                                            time: Math.floor(new Date(`${parts[0].replace(/\./g, '-')}T${parts[1].length === 5 ? parts[1] + ':00' : parts[1]}Z`).getTime() / 1000),
                                                            open: o, high: h, low: l, close: c, volume: parts.length >= 7 ? parseFloat(parts[6]) : 0
                                                        });
                                                    }
                                                }
                                            }

                                            if (parsedCandles.length > 0) {
                                                await clearHistoricalData(targetSymbol, timeframe);
                                                await saveHistoricalData(targetSymbol, timeframe, parsedCandles);
                                                alert(`Sucesso! ${parsedCandles.length} candles carregados para ${targetSymbol}.`);
                                            } else {
                                                alert("CSV inválido ou vazio.");
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            alert("Erro ao ler CSV.");
                                        }
                                    };
                                    reader.readAsText(file);
                                }} style={{ display: 'none' }} />
                            </label>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button type="submit" style={{ flex: 1, padding: '10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                                Criar Sessão
                            </button>
                            <button type="button" onClick={() => setIsCreating(false)} style={{ flex: 1, padding: '10px', background: 'transparent', color: 'white', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                                Voltar
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
