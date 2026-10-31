/* Extension-only early theme and runtime selection. */
(() => {
  'use strict';
  globalThis.IKnowStudyWorkspaceProduction = true;
  document.documentElement.dataset.studyRuntime = 'extension';
  try {
    const theme = localStorage.getItem('iknowReaderTheme');
    if (['paper','midnight','tokyo','forest'].includes(theme)) document.documentElement.dataset.ikrTheme = theme;
  } catch { /* The normal theme service also reads the extension preference. */ }
})();
