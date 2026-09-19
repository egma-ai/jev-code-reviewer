/* global JevReviewerUI */
(async () => {
  const container = document.getElementById('review');
  try {
    const response = await fetch('/api/demo');
    if (!response.ok) throw new Error('The recorded review could not be loaded.');
    const report = await response.json();
    const changes = Array.isArray(report.changes) ? report.changes : [];
    const files = [...new Set(changes.flatMap((change) => Array.isArray(change.files) ? change.files : []).filter((file) => typeof file === 'string' && file))];

    document.getElementById('pr-title-text').textContent = report.title || 'Pull request review';
    document.getElementById('tab-file-count').textContent = String(files.length);
    document.getElementById('tree-file-count').textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
    document.getElementById('toolbar-change-count').textContent = `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`;

    const disclosure = document.getElementById('recorded-demo');
    const isPrepared = report.provenance?.explanations === 'prepared-copy';
    disclosure.title = isPrepared
      ? 'Priority classifications were recorded from live TypeSafe Jev API calls. The natural-language explanations are prepared demonstration copy, not OpenAI output.'
      : 'Priority classifications and explanations were recorded from live provider calls. Browsing this replay makes no API requests.';

    const tree = document.getElementById('file-tree-list');
    tree.replaceChildren();
    for (const path of files) {
      const link = document.createElement('a');
      link.href = '#review';
      link.className = 'gh-file-tree__item';
      link.title = path;
      const parts = path.split('/');
      const name = document.createElement('span');
      name.className = 'gh-file-tree__name';
      name.textContent = parts.pop();
      const directory = document.createElement('span');
      directory.className = 'gh-file-tree__path';
      directory.textContent = parts.length ? `${parts.join('/')}/` : '';
      link.append(directory, name);
      link.addEventListener('click', (event) => {
        const candidate = [...container.querySelectorAll('details')].find((node) => node.textContent.includes(path));
        if (!candidate) return;
        event.preventDefault();
        candidate.open = true;
        candidate.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      tree.append(link);
    }

    JevReviewerUI.renderReview(container, report);
  } catch (error) {
    container.replaceChildren();
    const message = document.createElement('div');
    message.className = 'gh-load-error';
    message.textContent = error instanceof Error ? error.message : 'The recorded review could not be loaded.';
    container.append(message);
  }
})();
