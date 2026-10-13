import {calculateAutomatic, expenseLedger, logText, money} from './core.js';
const $ = id => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
let collapsed = false;
let running = false;
let latest = '';
let latestResult = null;
let pendingItems = [];
let sharedScope = null;
const SHARED_KEYS = ['department', 'costCenter', 'departure', 'arrival'];
function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}
function renderLedger(result) {
  const container = $('ledger');
  container.replaceChildren();
  if (!result?.groups.length) { container.append(element('p', '无有效费用分组。')); return; }
  for (const group of expenseLedger(result)) {
    const block = element('section'); block.className = 'ledger-group';
    block.append(element('h3', `${group.title} · ${group.category} / ${group.kind} / ${group.property} / ${group.rate}`));
    const status = element('p', `${group.status} · ${group.invoices.length} 张发票${group.reason ? ` · ${group.reason}` : ''}`); status.className = 'ledger-state'; block.append(status);
    const table = element('table'); table.setAttribute('aria-label', `${group.title}对应发票`);
    const head = element('thead'); const header = element('tr');
    for (const title of ['发票号码', '发票内容', '价税合计', '票面税率', '票面税额', '可抵扣税额']) { const cell = element('th', title); cell.scope = 'col'; header.append(cell); }
    head.append(header); table.append(head);
    const body = element('tbody');
    for (const invoice of group.invoices) {
      const row = element('tr');
      for (const value of [invoice.number, invoice.content, invoice.amount, invoice.invoiceRate, invoice.tax, invoice.deductibleTax]) row.append(element('td', value));
      body.append(row);
    }
    table.append(body);
    const foot = element('tfoot'); const total = element('tr'); const label = element('th', '本事项合计'); label.colSpan = 2; label.scope = 'row';
    total.append(label, element('td', money(group.amountCents)), element('td', ''), element('td', money(group.invoiceTaxCents)), element('td', money(group.taxCents))); foot.append(total); table.append(foot);
    block.append(table, element('p', `费用事项未税金额 ${money(group.netCents)} 元。`));
    container.append(block);
  }
}
async function request(command, payload) {
  if (demo) return parent.JdlExpenseAdapter.run(command, payload);
  return chrome.runtime.sendMessage({channel: 'jdl-panel', command, payload});
}
function renderPending() {
  $('pending').replaceChildren();
  for (const value of [...new Set(pendingItems)]) $('pending').append(element('li', value));
  if (!pendingItems.length) $('pending').append(element('li', '无待补或跳过项。'));
}
async function saveLog() {
  if (demo) return;
  try {
    const stored = await chrome.storage.local.get('expenseLogs');
    const entry = {id: crypto.randomUUID(), at: new Date().toISOString(), text: latest, count: latestResult?.sourceCount || 0};
    await chrome.storage.local.set({expenseLogs: [entry, ...(stored.expenseLogs || [])].slice(0, 20)});
  } catch { $('status').textContent += ' 本机日志保存失败，请下载日志。'; }
}
function displayShared(reply) {
  if (sharedScope && sharedScope.context !== reply.context) {
    for (const key of SHARED_KEYS) $(`shared-${key}`).value = '';
    $('shared-status').textContent = '已切换报销单，请重新选择要批量填写的值。';
  }
  sharedScope = {context: reply.context, fingerprint: reply.fingerprint};
  $('shared').hidden = !reply.rowCount;
  $('shared-count').textContent = `（当前 ${reply.rowCount} 项）`;
  for (const key of SHARED_KEYS) {
    const list = $(`options-${key}`);
    list.replaceChildren();
    for (const label of reply.options?.[key] || []) { const option = document.createElement('option'); option.value = label; list.append(option); }
  }
}
async function refreshShared() {
  if (running) return;
  try {
    const reply = await request('sharedOptions');
    if (!reply.ok) throw new Error(reply.error);
    displayShared(reply);
  } catch (error) {
    sharedScope = null;
    $('shared').hidden = true;
    $('shared-status').textContent = `无法读取当前费用事项：${error.message}`;
  }
}
$('collapse').addEventListener('click', async () => {
  collapsed = !collapsed;
  $('body').hidden = collapsed;
  $('collapse').textContent = collapsed ? '展开' : '收起';
  $('collapse').setAttribute('aria-expanded', String(!collapsed));
  if (demo) parent.document.getElementById('jdl-expense-panel').style.height = collapsed ? '58px' : '620px';
  else {
    try { await chrome.runtime.sendMessage({channel: 'jdl-panel', command: 'collapse', collapsed}); }
    catch { $('body').hidden = false; collapsed = false; $('collapse').textContent = '收起'; }
  }
});
$('generate').addEventListener('click', async () => {
  if (running) return;
  running = true; $('generate').disabled = true; $('apply-shared').disabled = true; $('outcome').hidden = true;
  $('body').setAttribute('aria-busy', 'true');
  $('pending').replaceChildren();
  let result;
  const pending = [];
  try {
    $('status').textContent = '正在读取全部发票…';
    const read = await request('read');
    if (!read.ok) throw new Error(read.error);
    result = calculateAutomatic(read.snapshot);
    pending.push(...result.errors, ...result.warnings);
    if (!result.ready) throw new Error('没有可填写的有效发票，原费用事项未修改。');
    $('status').textContent = `正在填写 ${result.groups.length} 个费用分组…`;
    const reply = await request('automatic', result);
    if (!reply.ok) throw new Error(reply.error);
    result.writeOutcome = {writtenGroups: reply.writtenGroups || [], skippedGroups: reply.skippedGroups || []};
    pending.push(...reply.pending);
    result.events.push({at: new Date().toISOString(), message: reply.message}, ...reply.pending.map(message => ({at: new Date().toISOString(), message})));
    $('status').textContent = reply.message;
  } catch (error) {
    $('status').textContent = `操作未全部完成：${error.message}`;
    pending.push(error.message);
    if (result) result.events.push({at: new Date().toISOString(), message: `操作未全部完成：${error.message}`});
  } finally {
    pendingItems = pending;
    renderPending();
    latestResult = result || null;
    latest = result ? logText(result) : `报销事项助手\n${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}\n${$('status').textContent}`;
    renderLedger(result);
    $('log').textContent = latest; $('outcome').hidden = false;
    await saveLog();
    running = false; $('generate').disabled = false; $('body').setAttribute('aria-busy', 'false');
    $('apply-shared').disabled = false;
    await refreshShared();
  }
});
$('apply-shared').addEventListener('click', async () => {
  if (running) return;
  running = true; $('generate').disabled = true; $('apply-shared').disabled = true;
  $('body').setAttribute('aria-busy', 'true');
  try {
    if (!sharedScope) throw new Error('尚未读取到当前费用事项，请刷新报销页面后重试。');
    const values = Object.fromEntries(SHARED_KEYS.map(key => [key, $(`shared-${key}`).value.trim()]));
    $('shared-status').textContent = '正在将公共字段填写到当前费用事项…';
    const reply = await request('applyShared', {...sharedScope, values});
    if (!reply.ok) throw new Error(reply.error);
    displayShared(reply);
    $('shared-status').textContent = reply.message;
    pendingItems = pendingItems.filter(item => !/待补(?:费用部门|成本中心|出发城市|到达城市)/.test(item));
    pendingItems.push(...reply.missing, ...reply.pending);
    renderPending();
    const names = {department: '费用部门', costCenter: '成本中心', departure: '出发城市', arrival: '到达城市'};
    const lines = [reply.message, ...reply.written.map(item => `第 ${item.position} 行${names[item.field]}：${item.label}`), ...reply.pending];
    latest = `${latest || '佳利达 · 费用事项操作日志'}\n\n【公共字段批量填写】\n${lines.join('\n')}`;
    $('log').textContent = latest;
    $('outcome').hidden = false;
    await saveLog();
  } catch (error) {
    $('shared-status').textContent = `批量填写未全部完成：${error.message}`;
  } finally {
    running = false; $('generate').disabled = false; $('apply-shared').disabled = false;
    $('body').setAttribute('aria-busy', 'false');
    await refreshShared();
  }
});
for (const key of SHARED_KEYS) $(`shared-${key}`).addEventListener('focus', () => { if (!running) refreshShared(); });
refreshShared();
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob(['\uFEFF', latest], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `报销日志-${Date.now()}.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
