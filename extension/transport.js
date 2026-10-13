const params = new URLSearchParams(location.search);
export const demoMode = params.get('demo') === '1';
const sourceId = Number(params.get('source'));
let demoFrame;

export async function connect() {
  if (demoMode) {
    demoFrame = document.createElement('iframe');
    demoFrame.title = '模拟报销表单';
    demoFrame.id = 'demo-frame';
    // The packaged demo uses an extension page, the local demo uses the sibling fixture.
    demoFrame.src = 'demo/form.html';
    document.getElementById('demo-source').append(demoFrame);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('模拟表单加载失败，请刷新重试。')), 10000);
      demoFrame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, {once: true});
    });
    return;
  }
  if (!Number.isInteger(sourceId) || sourceId <= 0 || !globalThis.chrome?.scripting) throw new Error('请从报销页面的插件图标打开助手。');
}

export async function request(command, payload) {
  if (demoMode) return demoFrame.contentWindow.JdlExpenseAdapter.run(command, payload);
  // No page messages are accepted: only extension-owned code invokes the form adapter.
  await chrome.scripting.executeScript({target: {tabId: sourceId}, world: 'MAIN', files: ['page-adapter.js']});
  const results = await chrome.scripting.executeScript({
    target: {tabId: sourceId}, world: 'MAIN',
    func: (operation, plan) => window.JdlExpenseAdapter.run(operation, plan), args: [command, payload || null]
  });
  const response = results[0]?.result;
  if (!response) throw new Error('未能读取原页面，请保持报销页面打开并重新点击插件图标。');
  return response;
}

export async function readHistory() {
  if (globalThis.chrome?.storage?.local) return (await chrome.storage.local.get('expenseLogs')).expenseLogs || [];
  try { return JSON.parse(localStorage.getItem('expenseLogs') || '[]'); } catch { return []; }
}

export async function saveHistory(history) {
  const recent = history.slice(0, 20);
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({expenseLogs: recent});
  else localStorage.setItem('expenseLogs', JSON.stringify(recent));
}
