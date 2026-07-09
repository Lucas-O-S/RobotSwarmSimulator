// Casca mínima da UI — a visualização 2D chega na Fase 2 (MapView).
// O núcleo de simulação vive em src/core/ e NÃO importa nada de React.

export default function App() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>RobotSwarmSimulator</h1>
      <p>
        Fase 1 (núcleo headless) concluída. Rode <code>npm test</code> e{' '}
        <code>npm run demo</code>. O mapa 2D chega na Fase 2.
      </p>
    </main>
  );
}
