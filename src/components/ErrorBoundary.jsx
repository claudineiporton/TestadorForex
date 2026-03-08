import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '20px',
                    backgroundColor: '#0d1117',
                    color: '#f85149',
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontFamily: 'sans-serif'
                }}>
                    <h1>Algo deu errado...</h1>
                    <p>O simulador encontrou um erro e não conseguiu carregar.</p>
                    <pre style={{
                        backgroundColor: '#161b22',
                        padding: '15px',
                        borderRadius: '8px',
                        border: '1px solid #30363d',
                        maxWidth: '80%',
                        overflow: 'auto',
                        color: '#c9d1d9'
                    }}>
                        {this.state.error && (this.state.error.stack || this.state.error.toString())}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '20px',
                            padding: '10px 20px',
                            backgroundColor: '#58a6ff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer'
                        }}
                    >
                        Tentar Recarregar
                    </button>
                </div >
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
