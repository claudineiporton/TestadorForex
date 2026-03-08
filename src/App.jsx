import React, { useState, useEffect } from 'react';
import './App.css';
import SessionManager from './components/SessionManager';
import SessionWorkspace from './components/SessionWorkspace';
import Auth from './components/Auth';

const DEFAULT_SESSION = {
  id: 'default_startup_session',
  name: 'Sessão Inicial',
  initialBalance: 10000,
  currentBalance: 10000,
  selectedPairs: ['EURUSD'],
  startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
  endDate: new Date().toISOString().split('T')[0],
  positions: [],
  history: [],
  timeframe: 60
};

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [showSessionModal, setShowSessionModal] = useState(false);

  useEffect(() => {
    // Check for logged in user on mount
    const savedUser = localStorage.getItem('forex_active_user');
    if (savedUser) {
      setCurrentUser(JSON.parse(savedUser));
    }
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    localStorage.setItem('forex_active_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveSession(null);
    localStorage.removeItem('forex_active_user');
  };

  // Restore active session on mount
  useEffect(() => {
    const savedActive = localStorage.getItem('forex_active_session_id');
    // Se quiser que não tenha sessão e abra o modal de cara, remova o default. 
    // Como o usuário pediu para a tela principal ser a de trading por padrão:
    if (savedActive) {
      const allSessions = JSON.parse(localStorage.getItem('forex_sim_sessions') || '[]');
      const session = allSessions.find(s => s.id === savedActive);
      if (session) {
        setActiveSession(session);
      }
    } else {
      // Se for a primeira vez, vamos abrir o modal de cara depois do render para ele criar se quiser,
      // mas a tela de fundo já vai ser o workspace.
      setShowSessionModal(true);
    }
  }, []);

  const handleSelectSession = (session) => {
    setActiveSession(session);
    localStorage.setItem('forex_active_session_id', session.id);
    setShowSessionModal(false);
  };

  const handleEndSession = () => {
    setActiveSession(null);
    localStorage.removeItem('forex_active_session_id');
    setShowSessionModal(true);
  };

  const handleSaveSession = (updatedSession) => {
    // Keep local activeSession state updated safely
    if (updatedSession.id === 'default_startup_session') return; // Don't save the placeholder

    setActiveSession(updatedSession);
    const allSessions = JSON.parse(localStorage.getItem('forex_sim_sessions') || '[]');
    const newSessions = allSessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    localStorage.setItem('forex_sim_sessions', JSON.stringify(newSessions));
  };

  const currentSession = activeSession || DEFAULT_SESSION;

  if (!currentUser) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <>
      <SessionWorkspace
        sessionConfig={currentSession}
        onSaveSession={handleSaveSession}
        onEndSession={handleEndSession}
        onNewSession={() => setShowSessionModal(true)}
        onLogout={handleLogout}
        currentUser={currentUser}
      />

      {showSessionModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ width: '100%', maxWidth: '850px' }}>
            <SessionManager onSelectSession={handleSelectSession} onClose={activeSession ? () => setShowSessionModal(false) : null} />
          </div>
        </div>
      )}
    </>
  );
}

export default App;
