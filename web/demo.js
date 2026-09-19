/* global JevReviewerUI */
(async () => {
  const container = document.getElementById('review');
  try {
    const response = await fetch('/api/demo');
    if (!response.ok) throw new Error('The recorded demo is not available yet.');
    const report = await response.json();
    JevReviewerUI.renderReview(container, report, { freshness: 'unverified' });
    const prepared = report.provenance?.explanations === 'prepared-copy';
    document.getElementById('run-label').textContent = prepared ? 'REAL JEV DECISIONS · PREPARED DEMO EXPLANATIONS' : 'RECORDED LIVE RUN · NO KEYS NEEDED';
    document.querySelector('.disclosure').textContent = prepared
      ? 'These priorities were recorded from real Jev API calls on the linked demonstration PR. Explanation text was prepared for the demo because the OpenAI account had exhausted credits. No API calls are made while browsing this replay. Priorities suggest where to look; they do not establish correctness.'
      : 'This is a recorded run of Jev and OpenAI on a demonstration PR. No API calls are made while browsing this replay. Priorities suggest where to look; they do not establish correctness.';
  } catch (error) { container.textContent = error.message; }
})();
