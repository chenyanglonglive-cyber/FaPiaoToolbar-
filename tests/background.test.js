import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function fixture(url = 'http://crm.jd-link.com:8888/spa/workflow/static4form/index.html') {
  let handler;
  const calls = [];
  const chrome = {
    runtime: {id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`, onMessage: {addListener: fn => {handler = fn;}}},
    tabs: {get: async id => ({id, url}), sendMessage: async (...args) => calls.push({type:'message', args})},
    scripting: {executeScript: async args => {calls.push({type:'script', args}); return [{result:{ok:true, snapshot:{}}}];}}
  };
  vm.runInNewContext(await fs.readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), {chrome, URL});
  const sender = {id: chrome.runtime.id, tab: {id: 7}, url: chrome.runtime.getURL('panel.html')};
  return {handler, sender, calls};
}
test('嵌入扩展窗通过所属标签页调用 MAIN 适配器，不接受任意目标标签页', async () => {
  const f = await fixture();
  const reply = await new Promise(resolve => f.handler({channel:'jdl-panel',command:'read',tabId:999}, f.sender, resolve));
  assert.equal(reply.ok,true); assert.equal(f.calls[0].args.target.tabId,7); assert.equal(f.calls[0].args.world,'MAIN');
});
test('拒绝网站来源及非面板扩展页面的指令', async () => {
  const f = await fixture();
  assert.equal(f.handler({channel:'jdl-panel',command:'automatic'}, {...f.sender,url:'http://crm.jd-link.com:8888/'},()=>assert.fail('unexpected reply')),undefined);
  assert.equal(f.handler({channel:'jdl-panel',command:'automatic'}, {...f.sender,id:'other-extension'},()=>assert.fail('unexpected reply')),undefined);
  assert.equal(f.calls.length,0);
});
test('页面切换到其他域名后阻止操作', async () => {
  const f = await fixture('https://example.com/');
  const reply = await new Promise(resolve => f.handler({channel:'jdl-panel',command:'read'},f.sender,resolve));
  assert.equal(reply.ok,false); assert.equal(f.calls.length,0);
});
test('收起只发送调整悬浮窗尺寸的扩展消息', async () => {
  const f = await fixture();
  const reply = await new Promise(resolve => f.handler({channel:'jdl-panel',command:'collapse',collapsed:true},f.sender,resolve));
  assert.equal(reply.ok,true); assert.equal(f.calls[0].type,'message'); assert.equal(f.calls[0].args[1].collapsed,true);
});
test('首行公共字段读取与复制仅转发给所属报销页', async () => {
  const f = await fixture();
  for (const command of ['firstRowState', 'applyFirstRow']) {
    const reply = await new Promise(resolve => f.handler({channel:'jdl-panel',command,payload:{context:'mock'}},f.sender,resolve));
    assert.equal(reply.ok,true);
  }
  assert.deepEqual(f.calls.map(call=>call.args.args[0]),['firstRowState','applyFirstRow']);
  assert.equal(f.calls.every(call=>call.args.target.tabId===7&&call.args.world==='MAIN'),true);
});
