import {calculateAutomatic, expenseLedger, logText, money} from './core.js';
const $ = id => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
let collapsed = false;
let running = false;
let latest = '';
let latestResult = null;
let pendingItems = [];
let sharedScope = null;
function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}
function renderLedger(result) {
  const container = $('ledger');
  container.replaceChildren();
  if (!result?.groups.length) { container.append(element('p', '无有效费用分组。')); return; }
  if (result.manualCategoryOverride) container.append(element('p', '费用小类已按首行覆盖；下表保留生成时的发票分组，最终小类请以原报销页为准。'));
  for (const group of expenseLedger(result)) {
    const block = element('section'); block.className = 'ledger-group';
    block.append(element('h3', `${group.title} · ${result.workflowId === '232' ? `${group.bigCategory || '大类待补'} / ${group.smallCategory || '小类待补'} / ` : ''}${group.category} / ${group.kind} / ${group.property} / ${group.rate}`));
    const status = element('p', `${group.status} · ${group.source === 'travelAllowance' ? group.description : `${group.invoices.length - (group.attachmentAmountCents ? 1 : 0)} 张表格发票${group.attachmentAmountCents ? ' + 附件金额（票种未核实）' : ''}`}${group.reason ? ` · ${group.reason}` : ''}`); status.className = 'ledger-state'; block.append(status);
    if (group.source === 'travelAllowance') {
      block.append(element('p', `出差补助 ${money(group.amountCents)} 元；可抵扣税额 0.00 元。`));
      container.append(block);
      continue;
    }
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
function displayFirstRow(reply) {
  if (sharedScope && sharedScope.context !== reply.context) {
    $('shared-status').textContent = '已切换报销单，请先在原页面填写首行。';
  }
  sharedScope = {context: reply.context};
  $('shared').hidden = !reply.rowCount;
  $('shared-count').textContent = `（当前 ${reply.rowCount} 项）`;
  $('first-row-hint').textContent = `先在原报销页第 ${reply.sourcePosition} 行填好${(reply.fields || []).map(item => item.label).join('、')}；点击时读取系统当前选值，只复制非空字段。金额、票种和税率不会改变。${reply.workflowId === '232' ? '日常费用单的其他行费用小类会被首行覆盖，请核对。' : ''}`;
  $('apply-first-row').disabled = running || reply.rowCount < 2;
}
async function refreshFirstRow() {
  if (running) return;
  try {
    const reply = await request('firstRowState');
    if (!reply.ok) throw new Error(reply.error);
    displayFirstRow(reply);
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
  running = true; $('generate').disabled = true; $('apply-first-row').disabled = true; $('outcome').hidden = true;
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
    $('apply-first-row').disabled = false;
    await refreshFirstRow();
  }
});
$('apply-first-row').addEventListener('click', async () => {
  if (running) return;
  running = true; $('generate').disabled = true; $('apply-first-row').disabled = true;
  $('body').setAttribute('aria-busy', 'true');
  try {
    if (!sharedScope) throw new Error('尚未读取到当前费用事项，请刷新报销页面后重试。');
    $('shared-status').textContent = '正在读取首行并复制公共字段…';
    const reply = await request('applyFirstRow', sharedScope);
    if (!reply.ok) throw new Error(reply.error);
    displayFirstRow(reply);
    $('shared-status').textContent = reply.message;
    if (reply.workflowId === '232' && reply.written.some(item => item.field === 'smallCategory') && latestResult) {
      latestResult.manualCategoryOverride = true;
      renderLedger(latestResult);
    }
    pendingItems = pendingItems.filter(item => !(reply.fields || []).some(field => item.includes(`待补${field.label}`)));
    pendingItems.push(...reply.missing, ...reply.pending);
    renderPending();
    const names = Object.fromEntries((reply.fields || []).map(item => [item.key, item.label]));
    const lines = [reply.message, ...(reply.workflowId === '232' && reply.written.some(item => item.field === 'smallCategory') ? ['日常费用单：费用小类已按首行覆盖，请核对发票用途。'] : []), ...reply.written.map(item => `第 ${item.position} 行${names[item.field]}：${item.label}`), ...reply.pending];
    latest = `${latest || '佳利达 · 费用事项操作日志'}\n\n【应用首行到所有】\n${lines.join('\n')}`;
    $('log').textContent = latest;
    $('outcome').hidden = false;
    await saveLog();
  } catch (error) {
    $('shared-status').textContent = `首行复制未全部完成：${error.message}`;
  } finally {
    running = false; $('generate').disabled = false; $('apply-first-row').disabled = false;
    $('body').setAttribute('aria-busy', 'false');
    await refreshFirstRow();
  }
});
refreshFirstRow();
window.addEventListener('focus', () => { if (!running) refreshFirstRow(); });
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob(['\uFEFF', latest], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `报销日志-${Date.now()}.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
