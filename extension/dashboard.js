import {CATEGORIES, calculate, extractRoute, logText, money} from './core.js';
import {connect, demoMode, readHistory, request, saveHistory} from './transport.js';

const $ = id => document.getElementById(id);
let result;
let history = [];
let overrides = {};
let previousContext = '';
let working = false;
let dirty = false;
let tripDirty = false;
let canUndo = false;
let invoiceIdentities = new Map();
let latestLog = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function status(message, type = 'info') { $('status').textContent = message; $('status').className = `notice ${type}`; }
function buttons() {
  document.querySelector('main').setAttribute('aria-busy', String(working));
  $('calculate').disabled = working;
  $('apply').disabled = working || dirty || !result?.ready;
  $('undo').disabled = working || !canUndo;
  $('download').disabled = !latestLog;
  $('view-log').disabled = !latestLog;
}

async function remember() {
  if (!result) return;
  const entry = {id: result.id, at: result.calculatedAt, count: result.sourceCount, groups: result.groups.length,
    amount: money(result.totals.amountCents), text: logText(result), demo: demoMode};
  latestLog = entry;
  try {
    const persisted = await readHistory();
    history = [entry, ...persisted.filter(item => item.id !== entry.id)].slice(0, 20);
    await saveHistory(history);
  } catch { history = [entry, ...history.filter(item => item.id !== entry.id)].slice(0, 20); status('计算已完成，但本机日志保存失败；请下载本次日志。', 'warning'); }
  renderHistory();
}

async function logReadFailure(message) {
  const at = new Date().toISOString();
  const entry = {id: crypto.randomUUID(), at, count: 0, groups: 0, amount: '0.00', demo: demoMode, failed: true,
    text: `佳利达 · 费用事项计算日志\n计算时间：${new Date(at).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}（北京时间）\n本次未能完成读取或计算。\n失败原因：${message}\n本次没有生成可填入的结果。`};
  latestLog = entry;
  try { history = [entry, ...await readHistory()].slice(0, 20); await saveHistory(history); } catch { history = [entry, ...history].slice(0, 20); }
  $('log-summary').replaceChildren(node('p', '本次计算未完成', 'error-text'), node('small', message, 'muted'));
  renderHistory();
}

function download(text, filename) {
  const blob = new Blob(['\uFEFF', text], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = node('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderHistory() {
  $('history').replaceChildren();
  if (!history.length) $('history').append(node('p', '本机尚无计算记录', 'muted'));
  for (const item of history) {
    const button = node('button', null, 'history-item');
    button.append(node('span', `${new Date(item.at).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}${item.demo ? ' · 模拟' : ''}`), node('small', item.failed ? '读取或计算未完成' : `${item.count} 张发票 · ${item.groups} 组 · ¥ ${item.amount}`));
    button.addEventListener('click', () => { $('log-content').textContent = item.text; $('log-dialog').showModal(); });
    $('history').append(button);
  }
}

function renderSummary() {
  $('category-summary').replaceChildren();
  for (const category of CATEGORIES) {
    const groups = result?.groups.filter(group => group.category === category) || [];
    const count = result?.invoices.filter(invoice => invoice.category === category).length || 0;
    const amount = groups.reduce((total, group) => total + group.amountCents, 0);
    const button = node('button', null, `category-card category-${CATEGORIES.indexOf(category)}`);
    button.setAttribute('aria-label', `查看${category}发票`);
    button.append(node('span', category, 'category-name'), node('strong', `¥ ${money(amount)}`, 'category-amount'), node('small', `${count} 张发票 · ${groups.length} 个事项`));
    button.addEventListener('click', () => { $('filter').value = category; renderInvoices(); $('filter').focus(); });
    $('category-summary').append(button);
  }
}

function renderGroups() {
  $('groups').replaceChildren();
  if (!result?.groups.length) { $('groups').append(node('p', '暂无可汇总的发票，请检查发票信息。', 'empty-cell')); return; }
  for (const group of result.groups) {
    const details = node('details', null, 'expense-group');
    const summary = node('summary');
    const title = node('div', null, 'group-title');
    title.append(node('span', group.category, `category-tag category-${CATEGORIES.indexOf(group.category)}`), node('strong', `${group.property} · ${group.rate}`), node('small', `${group.invoices.length} 张发票`));
    const amount = node('div', null, 'group-amount');
    amount.append(node('strong', `¥ ${money(group.amountCents)}`), node('small', `可抵扣税额 ${money(group.taxCents)}`));
    summary.append(title, amount);
    details.append(summary);
    const list = node('ul', null, 'receipt-list');
    for (const invoice of group.invoices) {
      const item = node('li');
      item.append(node('code', invoice.number), node('span', invoice.content), node('small', `金额 ${invoice.amount} / 税额 ${invoice.tax}`));
      list.append(item);
    }
    details.append(list); $('groups').append(details);
  }
  $('totals').hidden = false;
  $('totals').replaceChildren(node('span', '有效发票合计'), node('strong', `¥ ${money(result.totals.amountCents)}`), node('small', `可抵扣税额合计 ¥ ${money(result.totals.taxCents)}`));
  $('group-count').textContent = `${result.sourceCount} 张发票 → ${result.groups.length} 条费用事项 · 点击分组查看对应发票`;
}

function choiceSelect(options, value, label, change) {
  const select = node('select'); select.setAttribute('aria-label', label);
  for (const optionValue of options) { const option = node('option', optionValue || '请选择'); option.value = optionValue; select.append(option); }
  select.value = value;
  select.addEventListener('change', () => { change(select.value); dirty = true; $('stamp').textContent = '待重算'; status('分类或票种已调整，请点击“读取并计算”更新分组和日志。', 'warning'); buttons(); });
  return select;
}

function renderInvoices() {
  $('invoices').replaceChildren();
  const filter = $('filter').value;
  const invoices = result?.invoices.filter(invoice => filter === '全部' || invoice.category === filter) || [];
  if (!invoices.length) { const row = node('tr'); const cell = node('td', '此分类没有发票', 'empty-cell'); cell.colSpan = 7; row.append(cell); $('invoices').append(row); }
  for (const invoice of invoices) {
    const row = node('tr');
    const detail = node('td', null, 'invoice-description');
    detail.append(node('code', invoice.number || '缺少发票号'), node('span', invoice.content), node('small', invoice.issues.length ? invoice.issues.join('；') : invoice.reason, invoice.issues.length ? 'error-text' : 'muted'));
    const category = node('td');
    category.append(choiceSelect(CATEGORIES, overrides[invoice.id]?.category || invoice.category, `发票 ${invoice.number} 的分类`, value => { overrides[invoice.id] = {...overrides[invoice.id], category: value}; }));
    const property = node('td');
    property.append(choiceSelect(['', '普票', '专票', '电子打车票'], overrides[invoice.id]?.property || invoice.property, `发票 ${invoice.number} 的属性`, value => { overrides[invoice.id] = {...overrides[invoice.id], property: value}; }));
    row.append(detail, node('td', invoice.type, 'original-type'), category, property, node('td', invoice.rate), node('td', invoice.amount, 'numeric'), node('td', invoice.tax, 'numeric'));
    $('invoices').append(row);
  }
}

function renderLog() {
  if (!result) return;
  $('log-summary').replaceChildren(node('p', `${result.sourceCount} 张发票均已记录`));
  const list = node('ul');
  for (const category of CATEGORIES) {
    const count = result.invoices.filter(invoice => invoice.category === category).length;
    if (count) list.append(node('li', `${category}：${count} 张`));
  }
  $('log-summary').append(list, node('small', '包含发票号、发票内容、对应分类，以及每组金额和税额。', 'muted'));
}

async function doCalculate() {
  if (working) return;
  working = true; buttons(); status('正在读取报销页面中的全部发票…');
  try {
    const response = await request('read');
    if (!response.ok) throw new Error(response.error);
    const snapshot = response.snapshot;
    if (previousContext && previousContext !== snapshot.context) { overrides = {}; tripDirty = false; invoiceIdentities.clear(); }
    previousContext = snapshot.context;
    const activeRows = new Set(snapshot.invoices.map(invoice => String(invoice.row)));
    for (const row of Object.keys(overrides)) if (!activeRows.has(row)) delete overrides[row];
    for (const invoice of snapshot.invoices) {
      const row = String(invoice.row);
      const identity = JSON.stringify([invoice.number, invoice.content, invoice.type]);
      if (invoiceIdentities.has(row) && invoiceIdentities.get(row) !== identity) delete overrides[row];
      invoiceIdentities.set(row, identity);
    }
    if (!tripDirty) {
      const route = extractRoute(snapshot.descriptions);
      $('departure').value = route.departure; $('arrival').value = route.arrival; $('days').value = snapshot.days;
    }
    result = calculate(snapshot, overrides, {departure: $('departure').value, arrival: $('arrival').value, days: $('days').value});
    dirty = false; canUndo = snapshot.canUndo;
    renderSummary(); renderGroups(); renderInvoices(); renderLog();
    $('stamp').textContent = result.ready ? '待填入' : '待核对';
    const issues = [...result.errors, ...result.contextIssues, ...result.warnings];
    status(issues.length ? issues.join('；') : `已生成 ${result.groups.length} 条费用事项和逐票日志，请核对后填入。`, result.errors.length ? 'error' : issues.length ? 'warning' : 'success');
    await remember();
  } catch (error) {
    dirty = true; status(error.message, 'error');
    $('stamp').textContent = '待重算';
    await logReadFailure(error.message);
  } finally { working = false; buttons(); }
}

async function action(command) {
  if (working || (command === 'apply' && (!result?.ready || dirty))) return;
  working = true; buttons(); status(command === 'apply' ? '正在核对原页面并填入费用事项…' : '正在撤销最近一次填写…');
  try {
    const response = await request(command, command === 'apply' ? result : null);
    if (!response.ok) throw new Error(response.error);
    if (result) { result.events.push({at: new Date().toISOString(), message: response.message}); await remember(); }
    canUndo = command === 'apply';
    $('stamp').textContent = command === 'apply' ? '已填入' : '已撤销';
    status(response.message, 'success');
    if (demoMode) $('demo-source').open = true;
  } catch (error) {
    if (result) { result.events.push({at: new Date().toISOString(), message: `${command === 'apply' ? '填写' : '撤销'}失败：${error.message}`}); await remember(); }
    status(error.message, 'error');
    if (command === 'apply') { dirty = true; $('stamp').textContent = '待重算'; }
  } finally { working = false; buttons(); }
}

$('calculate').addEventListener('click', doCalculate);
$('apply').addEventListener('click', () => action('apply'));
$('undo').addEventListener('click', () => action('undo'));
$('filter').addEventListener('change', renderInvoices);
$('download').addEventListener('click', () => download(latestLog.text, `报销计算日志-${new Date(latestLog.at).toISOString().replace(/[:.]/g, '-')}.txt`));
$('view-log').addEventListener('click', () => { $('log-content').textContent = latestLog.text; $('log-dialog').showModal(); });
$('close-log').addEventListener('click', () => $('log-dialog').close());
$('clear-history').addEventListener('click', async () => { history = []; await saveHistory(history); renderHistory(); status('已清除本机历史日志。本次计算仍可下载。'); });
for (const id of ['departure', 'arrival', 'days']) $(id).addEventListener('input', () => {
  tripDirty = true; dirty = true; buttons();
  if (result) status('出差信息已调整，请重新计算以更新事项和日志。', 'warning');
});
renderSummary();
try {
  history = await readHistory(); renderHistory();
  if (demoMode) { $('mode-label').textContent = '模拟体验'; $('demo-notice').hidden = false; $('demo-source').hidden = false; }
  await connect();
} catch (error) { status(error.message, 'error'); $('calculate').disabled = true; }
