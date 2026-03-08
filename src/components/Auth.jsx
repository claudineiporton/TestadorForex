import React, { useState } from 'react';

export default function Auth({ onLogin }) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');

        if (!email || !password) {
            setError('Preencha todos os campos.');
            return;
        }

        const users = JSON.parse(localStorage.getItem('forex_users') || '{}');

        if (isLogin) {
            if (users[email] && users[email] === password) {
                onLogin({ email, provider: 'local' });
            } else {
                setError('Email ou senha incorretos.');
            }
        } else {
            if (users[email]) {
                setError('Este email já está cadastrado.');
            } else {
                users[email] = password;
                localStorage.setItem('forex_users', JSON.stringify(users));
                onLogin({ email, provider: 'local' });
            }
        }
    };

    const handleGoogleLogin = () => {
        // Simulando login do Google para o ambiente local/estático
        const mockGoogleUser = {
            email: 'usuario.google@gmail.com',
            name: 'Usuário Google',
            provider: 'google'
        };
        onLogin(mockGoogleUser);
    };

    return (
        <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            height: '100vh', width: '100vw', background: '#010409', color: 'white',
            fontFamily: 'sans-serif'
        }}>
            <div style={{
                background: '#0d1117', padding: '40px', borderRadius: '8px',
                border: '1px solid #30363d', width: '100%', maxWidth: '400px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)', textAlign: 'center'
            }}>
                <h1 style={{ color: 'var(--accent-color)', marginBottom: '10px' }}>ForexSim PRO</h1>
                <p style={{ color: '#8b949e', marginBottom: '30px', fontSize: '0.9rem' }}>
                    Acesse sua conta para continuar
                </p>

                {error && <div style={{ background: 'rgba(239, 83, 80, 0.1)', color: '#ef5350', padding: '10px', borderRadius: '4px', marginBottom: '20px', fontSize: '0.85rem', border: '1px solid rgba(239, 83, 80, 0.3)' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', textAlign: 'left' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', color: '#c9d1d9' }}>E-mail</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="seu@email.com"
                            style={{
                                width: '100%', padding: '10px', borderRadius: '4px',
                                border: '1px solid #30363d', background: '#161b22', color: 'white'
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', color: '#c9d1d9' }}>Senha</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            style={{
                                width: '100%', padding: '10px', borderRadius: '4px',
                                border: '1px solid #30363d', background: '#161b22', color: 'white'
                            }}
                        />
                    </div>
                    <button type="submit" style={{
                        padding: '12px', background: 'var(--accent-color)', color: 'white',
                        border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                        marginTop: '10px', fontSize: '1rem', transition: 'background 0.2s'
                    }}>
                        {isLogin ? 'Entrar' : 'Criar Conta'}
                    </button>
                </form>

                <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0' }}>
                    <div style={{ flex: 1, height: '1px', background: '#30363d' }}></div>
                    <span style={{ padding: '0 10px', color: '#8b949e', fontSize: '0.8rem' }}>ou</span>
                    <div style={{ flex: 1, height: '1px', background: '#30363d' }}></div>
                </div>

                <button onClick={handleGoogleLogin} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    width: '100%', padding: '10px', background: 'white', color: '#333',
                    border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                    fontSize: '0.9rem'
                }}>
                    <svg width="18" height="18" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                    Continuar com Google
                </button>

                <div style={{ marginTop: '20px', fontSize: '0.85rem', color: '#8b949e' }}>
                    {isLogin ? 'Não tem uma conta?' : 'Já tem uma conta?'}
                    <span
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                        style={{ color: 'var(--accent-color)', marginLeft: '5px', cursor: 'pointer' }}
                    >
                        {isLogin ? 'Cadastre-se' : 'Faça login'}
                    </span>
                </div>
            </div>
        </div>
    );
}
