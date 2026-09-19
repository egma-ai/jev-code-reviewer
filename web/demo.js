/* global JevReviewerUI */
(async () => {
  const container = document.getElementById('review');
  try {
    const response = await fetch('/api/demo');
    if (!response.ok) throw new Error('The recorded demo is not available yet.');
    const report = await response.json();
    JevReviewerUI.renderReview(container, report, { freshness: 'unverified' });
    document.getElementById('run-label').textContent = 'RECORDED LIVE RUN · NO KEYS NEEDED';
  } catch (error) { container.textContent = error.message; }
})();
