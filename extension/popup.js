async function openPanel() {
  const status = document.getElementById('popup-status');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const url = new URL(tab.url || '');
    if (url.hostname !== 'crm.jd-link.com' || url.port !== '8888' || !url.pathname.startsWith('/spa/workflow/')) throw new Error('请在差旅费报销单、业务招待报销单或日常费用报销单页面打开助手。');
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', files: ['page-adapter.js']});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['panel-container.js']});
    window.close();
  } catch (error) { status.textContent = error.message; }
}
document.getElementById('open').addEventListener('click', openPanel);
openPanel();
