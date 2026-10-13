chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html')) || message?.channel !== 'jdl-panel') return;
  (async () => {
    const tabId = sender.tab.id;
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url || '');
    if (url.hostname !== 'crm.jd-link.com' || url.port !== '8888' || !url.pathname.startsWith('/spa/workflow/')) throw new Error('请在佳利达差旅报销页面使用助手。');
    if (message.command === 'collapse') {
      await chrome.tabs.sendMessage(tabId, {channel: 'jdl-panel-size', collapsed: !!message.collapsed});
      return {ok: true};
    }
    if (!['read', 'automatic', 'sharedOptions', 'applyShared'].includes(message.command)) throw new Error('不支持的操作');
    const results = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN',
      func: (command, payload) => window.JdlExpenseAdapter.run(command, payload), args: [message.command, message.payload || null]});
    return results[0]?.result || {ok: false, error: '报销页面已刷新，请重新点击插件。'};
  })().then(reply, error => reply({ok: false, error: error.message}));
  return true;
});
