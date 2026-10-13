(() => {
  const id = 'jdl-expense-panel';
  const old = document.getElementById(id);
  if (old) { old.style.height = 'min(620px, calc(100vh - 100px))'; return; }
  const frame = document.createElement('iframe');
  frame.id = id;
  frame.title = '\u62a5\u9500\u4e8b\u9879\u52a9\u624b';
  frame.src = chrome.runtime.getURL('panel.html');
  frame.style.cssText = 'position:fixed!important;right:20px!important;top:80px!important;width:min(390px,calc(100vw - 40px))!important;height:min(620px,calc(100vh - 100px));z-index:2147483646!important;border:0!important;border-radius:16px!important;box-shadow:0 12px 48px #102d3b40!important;background:white!important;';
  document.documentElement.append(frame);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.channel === 'jdl-panel-size') frame.style.height = message.collapsed ? '58px' : 'min(620px, calc(100vh - 100px))';
  });
})();
