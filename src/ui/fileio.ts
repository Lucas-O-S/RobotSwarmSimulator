// Salvar/carregar cenário como ARQUIVO no browser (Fase 3).
// Efeitos de DOM isolados aqui; a validação do conteúdo é pura e vive em
// editorModel.parseScenarioFile.

/** Dispara o download de `data` como JSON identado. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
