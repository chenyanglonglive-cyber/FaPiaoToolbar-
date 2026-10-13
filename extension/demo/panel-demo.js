document.getElementById('show-panel').addEventListener('click', () => {
  if (document.getElementById('jdl-expense-panel')) return;
  const frame = document.createElement('iframe'); frame.id = 'jdl-expense-panel'; frame.title = '\u62a5\u9500\u4e8b\u9879\u52a9\u624b';
  frame.src = '../panel.html?demo=1';
  frame.style.cssText = 'position:fixed;right:20px;top:80px;width:min(390px,calc(100vw - 40px));height:620px;max-height:calc(100vh - 100px);z-index:10000;border:0;border-radius:16px;box-shadow:0 12px 48px #102d3b40';
  document.body.append(frame);
});
