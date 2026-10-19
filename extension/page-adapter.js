/* Runs only when the user invokes the extension. Never saves or submits a workflow. */
(() => {
  if (window.JdlExpenseAdapter?.version === '0.2.9') return;
  const TRAVEL_TARGET = {
    smallCategory: ['fyxl1', 'field21331'], departure: ['cfdd', 'field21313'],
    arrival: ['dddd', 'field21314'], days: ['tlts', 'field21315'],
    category: ['fymx', 'field21320'], property: ['fpzx', 'field21332'],
    rate: ['sl', 'field21323'], amount: ['bxje', 'field21319'], tax: ['se', 'field21324'],
    department: ['jzbm', 'field21326'], costCenter: ['cbzx', 'field21325']
  };
  const HOSPITALITY_TARGET = {
    property: ['fpzx', 'field21495'], rate: ['sl', 'field21491'],
    amount: ['bxje', 'field21489'], tax: ['se', 'field21488'],
    department: ['jzbm', 'field21494'], costCenter: ['cbzx', 'field21493']
  };
  const DAILY_TARGET = {
    smallCategory: ['fyxl', 'field21113'], property: ['xfpzx', 'field21118'],
    rate: ['sl', 'field21108'], amount: ['bxje', 'field21106'], tax: ['se', 'field21105'],
    department: ['jzbm', 'field21110'], costCenter: ['cbzx', 'field21109']
  };
  const workflowId = form => String(form.getBaseInfo?.().workflowid || new URLSearchParams(window.location.hash.split('?')[1] || '').get('workflowid') || '');
  const LABELS = {交通: '交通费', 住宿: '住宿费', 餐费: '餐费', 其他: '其他费用'};
  const owned = new Map();
  let ownershipContext = '';
  let busy = false;
  let lastUndo = null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value ?? '').replace(/\s/g, '').trim();
  const visible = element => !!element && element.getClientRects().length > 0;

  function api() {
    const form = window.WfForm;
    if (!form || typeof form.getFieldValue !== 'function') throw new Error('请等待报销表加载完成后重试。');
    const test = (window.location.hostname === '127.0.0.1' && /^\/(?:extension\/)?demo\//.test(window.location.pathname)) ||
      (window.location.protocol === 'chrome-extension:' && window.location.pathname === '/demo/form.html');
    if (!test && (window.location.hostname !== 'crm.jd-link.com' || window.location.port !== '8888')) throw new Error('仅支持指定的佳利达报销系统。');
    if (!['230', '231', '232'].includes(workflowId(form))) throw new Error('仅在差旅费、业务招待或日常费用报销单页面使用助手。');
    return form;
  }

  function context(form) {
    const base = form.getBaseInfo?.() || {};
    return JSON.stringify({workflow: workflowId(form), request: String(base.requestid || new URLSearchParams(location.hash.split('?')[1] || '').get('requestid') || 'new'),
      path: location.pathname, session: String(base.f_weaver_belongto_userid || base.userid || '')});
  }

  function fieldRoot(mark) { return document.querySelector(`[data-fieldmark="${mark}"]`); }
  function display(mark) {
    const root = fieldRoot(mark);
    if (!root) return (document.getElementById(`${mark}span`)?.textContent || document.getElementById(mark)?.value || '').trim();
    const selected = root.querySelector('.ant-select-selection-selected-value, .child-item, .ant-select-selection__choice__content');
    if (selected) return (selected.getAttribute('title') || selected.textContent || '').trim();
    const select = root.querySelector('select');
    if (select) return select.selectedOptions[0]?.textContent?.trim() || '';
    const span = document.getElementById(`${mark}span`);
    return (span?.textContent || root.textContent || '').replace(/\*/g, '').trim();
  }

  function indexes(form, detail) {
    const text = String(form.getDetailAllRowIndexStr(detail) || '');
    if (!text) return [];
    const values = text.split(',');
    if (values.some(value => !/^\d+$/.test(value))) throw new Error(`${detail} 的明细行编号无效。`);
    return values;
  }

  function tableFor(required) {
    const candidates = Array.from(document.querySelectorAll('table')).filter(table => {
      return Array.from(table.rows).some(row => row.closest('table') === table && required.every(label => Array.from(row.cells).some(cell => clean(cell.textContent) === label)));
    });
    // Weaver inserts a sticky header clone before the actual detail table.
    const bodies = candidates.filter(table => !/_head$/.test(table.id));
    return bodies.find(table => table.classList.contains('excelDetailTable')) || bodies.at(-1);
  }

  // Read-only Weaver cells may expose an id instead of data-fieldmark.
  function cellMark(cell) {
    if (!cell) return '';
    for (const element of [cell, ...cell.querySelectorAll('[data-fieldmark], [id]')]) {
      const mark = element.getAttribute('data-fieldmark') || element.id || '';
      const match = /^(field\d+_\d+)(?:span)?$/.exec(mark);
      if (match) return match[1];
    }
    return '';
  }

  function tableSchema(table, labels) {
    if (!table) throw new Error(`找不到${labels[0]}所在表格。`);
    const ownRows = Array.from(table.rows).filter(row => row.closest('table') === table);
    const header = ownRows.find(row => labels.every(label => Array.from(row.cells).some(cell => clean(cell.textContent) === label)));
    const dataRows = ownRows.filter(row => row !== header && row.cells.length === header.cells.length &&
      !Array.from(row.cells).some(cell => /^(?:合计|TOTAL|合计\/TOTAL)$/i.test(clean(cell.textContent))));
    const columns = {};
    for (const label of labels) {
      const index = Array.from(header.cells).findIndex(cell => clean(cell.textContent) === label);
      const fields = [...new Set(dataRows.map(row => cellMark(row.cells[index]).replace(/_\d+$/, '')).filter(Boolean))];
      if (fields.length > 1) throw new Error(`“${label}”列存在多个字段，无法确定发票来源。`);
      columns[label] = {index, field: fields[0] || ''};
    }
    const detail = header.cells[0]?.className.match(/\bdetail_(\d+)_/)?.[1] || table.querySelector('[data-cellmark]')?.getAttribute('data-cellmark')?.match(/^detail_(\d+)_/)?.[1];
    if (!detail) throw new Error('无法识别发票明细表，请检查页面是否为原报销表。');
    return {table, header, dataRows, detail: `detail_${detail}`, columns};
  }

  function readTable(form, labels) {
    const schema = tableSchema(tableFor(labels), labels);
    const all = indexes(form, schema.detail);
    const mounted = new Map();
    for (const domRow of schema.dataRows) {
      const marks = Array.from(domRow.cells).map(cellMark).filter(Boolean);
      const identities = [...new Set(marks.map(mark => mark.match(/_(\d+)$/)[1]))];
      const declared = domRow.getAttribute('data-rowindex');
      if ((declared != null && identities.some(row => row !== declared)) || identities.length > 1) {
        throw new Error('发票明细行标记不一致，请刷新页面后重试。');
      }
      const row = declared ?? identities[0];
      if (row != null && all.includes(row)) {
        if (mounted.has(row)) throw new Error('发票明细行标记重复，无法确定来源。');
        mounted.set(row, domRow);
      }
    }
    // Plain text fallback is allowed only for a complete, sequentially numbered table.
    const sequence = Array.from(schema.header.cells).findIndex(cell => clean(cell.textContent) === '序号');
    const numbered = sequence < 0 ? [] : schema.dataRows.filter(row => /^\d+$/.test(clean(row.cells[sequence]?.textContent)));
    if (numbered.length === all.length && numbered.every((row, index) => clean(row.cells[sequence].textContent) === String(index + 1))) {
      numbered.forEach((domRow, index) => {
        const known = [...mounted.entries()].find(([, element]) => element === domRow)?.[0];
        if ((known != null && known !== all[index]) || (mounted.has(all[index]) && mounted.get(all[index]) !== domRow)) {
          throw new Error('发票序号与系统明细行不一致，请刷新页面后重试。');
        }
        mounted.set(all[index], domRow);
      });
    }
    return all.map((row, ordinal) => {
      const domRow = mounted.get(row);
      const values = {row};
      for (const label of labels) {
        const column = schema.columns[label];
        const cell = domRow?.cells[column.index];
        const mark = cellMark(cell) || (column.field ? `${column.field}_${row}` : '');
        if (!mark && !cell) throw new Error(`无法读取第 ${ordinal + 1} 张发票的${label}（系统行号 ${row}），请刷新页面后重试。`);
        const raw = mark ? String(form.getFieldValue(mark) ?? '') : (cell.textContent || '').trim();
        const shown = mark ? (display(mark) || cell?.textContent?.trim() || '') : raw;
        values[label] = (label === '发票税率' || label === '发票类型') ? (shown || raw) : raw;
      }
      return values;
    });
  }

  function targetFields(form) {
    const fields = {};
    const workflow = workflowId(form);
    for (const [key, [name, fallback]] of Object.entries(workflow === '232' ? DAILY_TARGET : workflow === '231' ? HOSPITALITY_TARGET : TRAVEL_TARGET)) {
      const mark = form.convertFieldNameToId?.(name, 'detail_1');
      fields[key] = /^field\d+$/.test(mark || '') ? mark : fallback;
      const actual = document.querySelector(`[data-fieldname="${name}"][data-fieldmark]`);
      if (actual) fields[key] = actual.getAttribute('data-fieldmark').replace(/_\d+$/, '');
    }
    if (!tableFor(workflow === '232' ? ['费用小类', '发票属性', '报销金额'] : workflow === '231' ? ['发票属性', '报销金额', '税额'] : ['费用明细', '发票属性', '报销金额'])) throw new Error('未找到费用事项表。');
    return fields;
  }

  // Read only the mounted field's choices. Values are never inferred from option order.
  function choices(mark) {
    const root = fieldRoot(mark);
    if (!root) return [];
    const found = new Map();
    const put = (value, label) => {
      if (value == null || typeof value === 'object' || !String(label || '').trim()) return;
      found.set(`${String(value)}|${String(label)}`, {value: String(value), label: String(label).trim()});
    };
    const textOf = value => {
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (Array.isArray(value)) return value.map(textOf).join('');
      if (value?.props) return textOf(value.props.children);
      return '';
    };
    const visited = new WeakSet();
    const walk = (value, depth = 0, optionList = false) => {
      if (!value || typeof value !== 'object' || depth > 10 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1, optionList)); return; }
      if (optionList) put(value.value ?? value.id ?? value.key, value.label ?? value.name ?? value.showname ?? textOf(value.children));
      if (value.props) {
        put(value.props.value, value.props.label ?? value.props.title ?? textOf(value.props.children));
        walk(value.props, depth + 1);
      }
      for (const key of ['options', 'datas', 'data', 'items', 'children', 'condition', 'browserCondition']) {
        if (value[key]) walk(value[key], depth + 1, ['options', 'datas', 'data', 'items'].includes(key));
      }
    };
    root.querySelectorAll('select option').forEach(option => put(option.value, option.textContent));
    for (const element of [root, ...root.querySelectorAll('*')]) {
      for (const key of Object.keys(element)) {
        if (/^__react(?:Props|EventHandlers)\$/.test(key)) walk(element[key]);
        if (/^__react(?:Fiber|InternalInstance)\$/.test(key)) {
          let fiber = element[key];
          for (let depth = 0; fiber && depth < 10; depth++, fiber = fiber.return) {
            walk(fiber.memoizedProps);
            if (fiber.stateNode === root) break;
          }
        }
      }
    }
    return [...found.values()];
  }

  function normalizeLabel(value) {
    let text = clean(String(value ?? '').normalize('NFKC')).replace(/[\uE000-\uF8FF]/g, '');
    if (text.includes('/')) {
      const parts = text.split('/');
      if (parts[0] !== '中国') return `foreign:${text}`;
      text = parts.at(-1);
    }
    if (/^\d+(?:\.\d+)?%$/.test(text)) text = `${Number(text.slice(0, -1))}%`;
    return text.replace(/市$/, '');
  }
  function matchChoice(mark, labels) {
    const hits = choices(mark).filter(option => labels.some(label => normalizeLabel(option.label) === normalizeLabel(label)));
    const unique = [...new Map(hits.map(option => [option.value, option])).values()];
    if (unique.length > 1) throw new Error(`“${labels[0]}”有多个系统选项，不能自动确定。`);
    return unique[0];
  }

  async function waitUntil(fn, label, timeout = 8000) {
    const until = Date.now() + timeout;
    do { const value = fn(); if (value) return value; await sleep(100); } while (Date.now() < until);
    throw new Error(`${label}，请检查原页面后重试。`);
  }

  async function waitStable(read, label, quietMs = 700, timeout = 8000) {
    const until = Date.now() + timeout;
    let previous = JSON.stringify(read()); let changedAt = Date.now();
    while (Date.now() < until) {
      await sleep(100);
      const current = JSON.stringify(read());
      if (current !== previous) { previous = current; changedAt = Date.now(); }
      else if (Date.now() - changedAt >= quietMs) return;
    }
    throw new Error(`${label}尚未稳定，请等待系统联动结束后重试。`);
  }

  function valueInfo(form, mark, browser = false) {
    const value = String(form.getFieldValue(mark) || '');
    if (!browser || !value) return {value};
    const label = display(mark);
    return {value, specialobj: [{id: value, name: label}]};
  }

  function assertEditable(form, mark) {
    if (typeof form.getFieldCurViewAttr === 'function' && ![2, 3].includes(Number(form.getFieldCurViewAttr(mark)))) throw new Error(`字段 ${mark} 当前不可填写。`);
  }

  function setValue(form, mark, info) {
    assertEditable(form, mark);
    form.changeFieldValue(mark, info);
  }

  async function selectLabel(form, mark, labels, browser = false) {
    const root = fieldRoot(mark);
    // Browser components may contain intermediate province/city IDs; prefer a
    // pair already selected by the system, or perform the actual picker action.
    const choice = (!browser || root?.querySelector('select')) ? matchChoice(mark, labels) : null;
    if (choice) {
      setValue(form, mark, browser ? {value: choice.value, specialobj: [{id: choice.value, name: choice.label}]} : {value: choice.value});
      await waitUntil(() => String(form.getFieldValue(mark)) === choice.value, `${labels[0]}未被系统接受`);
      return;
    }
    if (!browser) {
      const allowed = choices(mark).map(option => option.label).filter(Boolean);
      if (allowed.length) throw new Error(`系统当前不允许“${labels[0]}”；可选项为 ${[...new Set(allowed)].join('、')}，请核对票种与系统规则`);
    }
    // A previously selected browser value provides an authoritative code/name pair.
    const field = mark.replace(/_\d+$/, '');
    if (browser) {
      for (const row of indexes(form, 'detail_1')) {
        const other = `${field}_${row}`;
        const value = String(form.getFieldValue(other) || '');
        if (value && labels.some(label => normalizeLabel(display(other)) === normalizeLabel(label))) {
          setValue(form, mark, {value, specialobj: [{id: value, name: display(other)}]});
          return;
        }
      }
    }
    // Fall back to the system's own dropdown/typeahead; never guess an internal ID.
    const combo = root?.querySelector('[role="combobox"], .ant-select-selection');
    if (!root) throw new Error(`无法找到“${labels[0]}”的系统选项。`);
    assertEditable(form, mark);
    const input = root.querySelector('input.ant-select-search__field, input[type="text"]');
    if (browser && !input) {
      const button = root.querySelector('button');
      if (!button) throw new Error(`无法打开“${labels[0]}”的选择窗口。`);
      const previous = new Set(Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible));
      if (previous.size) throw new Error('原页面有打开的选择窗口，请先关闭后再填写。');
      button.click();
      const dialog = await waitUntil(() => Array.from(document.querySelectorAll('[role="dialog"]')).find(element => visible(element) && !previous.has(element)), '费用小类选择窗口未加载', 15000);
      try {
        const cell = await waitUntil(() => {
          const hits = Array.from(dialog.querySelectorAll('td, [role="cell"]')).filter(element => visible(element) && labels.some(label => normalizeLabel(element.textContent) === normalizeLabel(label)));
          return hits.length === 1 ? hits[0] : null;
        }, `找不到“${labels[0]}”的唯一选项`, 10000);
        cell.click();
        await waitUntil(() => String(form.getFieldValue(mark) || '') && labels.some(label => normalizeLabel(display(mark)) === normalizeLabel(label)), `“${labels[0]}”未被系统接受`);
        return;
      } catch (error) {
        const cancel = Array.from(dialog.querySelectorAll('button')).find(button => clean(button.textContent) === '取消');
        cancel?.click();
        throw error;
      }
    }
    if (!combo) throw new Error(`无法找到“${labels[0]}”的系统选项。`);
    combo.click();
    if (input && browser) {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, labels[0]);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }
    const option = await waitUntil(() => {
      const candidates = Array.from(document.querySelectorAll('.ant-select-dropdown-menu-item, .wea-associative-search-data li, .wea-associative-search-data [title], .wea-city-picker-modal [title]'));
      const matching = candidates.filter(element => visible(element) && labels.some(label => normalizeLabel(element.getAttribute('title') || element.textContent) === normalizeLabel(label)));
      if (matching.length === 1) return matching[0];
      if (!browser && candidates.filter(visible).some(element => clean(element.textContent))) {
        const allowed = candidates.filter(visible).map(element => clean(element.textContent)).filter(Boolean);
        throw new Error(`系统当前不允许“${labels[0]}”；可选项为 ${allowed.join('、')}，请核对票种与系统规则`);
      }
      return null;
    }, `找不到“${labels[0]}”的唯一候选项；可先在原页面选好该字段再重新计算`);
    option.click();
    await waitUntil(() => String(form.getFieldValue(mark) || '') && labels.some(label => normalizeLabel(display(mark)) === normalizeLabel(label)), `“${labels[0]}”未被系统接受`);
  }

  function snapshot() {
    const form = api();
    const nonTravel = ['231', '232'].includes(workflowId(form));
    const currentContext = context(form);
    if (ownershipContext !== currentContext) { owned.clear(); lastUndo = null; ownershipContext = currentContext; }
    const raw = readTable(form, ['发票号码', '发票内容', '发票类型', '发票税率', '发票价税合计', '发票未税金额', '发票税额']);
    const applications = nonTravel ? [] : readTable(form, ['费用说明']);
    const daysField = nonTravel ? '' : document.querySelector('[data-fieldname="ccts"]')?.getAttribute('data-fieldmark') || 'field21403';
    const fields = targetFields(form);
    const existing = indexes(form, 'detail_1').map(row => ({row, owned: owned.has(row),
      values: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, String(form.getFieldValue(`${field}_${row}`) || '')]))}));
    const existingRoutes = nonTravel ? [] : existing.map(item => ({departure: display(`${fields.departure}_${item.row}`), arrival: display(`${fields.arrival}_${item.row}`)}))
      .filter(item => item.departure && item.arrival);
    return {context: currentContext, workflowId: workflowId(form), attachmentAmount: workflowId(form) === '232' ? String(form.getFieldValue('field21220') || '') : '',
      dailyCategory: workflowId(form) === '232' ? display('field21214') : '',
      days: nonTravel ? '' : String(form.getFieldValue(daysField) || ''), descriptions: applications.map(row => row['费用说明']), existingRoutes,
      invoices: raw.map(row => ({row: row.row, number: row['发票号码'], content: row['发票内容'], type: row['发票类型'], rate: row['发票税率'], amount: row['发票价税合计'], net: row['发票未税金额'], tax: row['发票税额']})),
      existing, fields, canUndo: !!lastUndo};
  }

  const FIRST_ROW_FIELDS = {department: '费用部门', smallCategory: '费用小类', costCenter: '成本中心', departure: '出发城市', arrival: '到达城市'};
  const copyFields = state => Object.entries(FIRST_ROW_FIELDS).filter(([key]) => !!state.fields[key]);

  function sharedState() {
    const form = api();
    const fields = targetFields(form);
    const allRows = indexes(form, 'detail_1');
    const rows = allRows.filter(row => ['category', 'amount'].filter(key => fields[key]).some(key => String(form.getFieldValue(`${fields[key]}_${row}`) || '').trim()));
    const currentContext = context(form);
    if (ownershipContext !== currentContext) { owned.clear(); lastUndo = null; ownershipContext = currentContext; }
    return {form, fields, allRows, rows, workflowId: workflowId(form), context: currentContext};
  }

  function firstRowState() {
    const state = sharedState();
    const fields = copyFields(state);
    const source = state.rows[0];
    const sourceValues = {};
    const missing = [];
    for (const [key, label] of fields) {
      if (source != null) sourceValues[key] = display(`${state.fields[key]}_${source}`);
      for (const row of state.rows) {
        const mark = `${state.fields[key]}_${row}`;
        if (!state.form.getFieldValue(mark)) missing.push(`第 ${state.allRows.indexOf(row) + 1} 行：待补${label}`);
      }
    }
    return {ok: true, context: state.context, workflowId: state.workflowId, rowCount: state.rows.length,
      sourcePosition: source == null ? 0 : state.allRows.indexOf(source) + 1,
      fields: fields.map(([key, label]) => ({key, label})), sourceValues, missing};
  }

  async function applyFirstRow(payload) {
    const state = sharedState();
    if (payload?.context !== state.context) throw new Error('报销单已切换，请重新打开或刷新助手。');
    if (state.rows.length < 2) throw new Error('当前不足两条费用事项，无需批量应用。');
    const source = state.rows[0];
    const fields = copyFields(state);
    const requested = fields.map(([key, label]) => {
      const mark = `${state.fields[key]}_${source}`;
      return {key, label, ...valueInfo(state.form, mark, true), shown: display(mark), browser: !fieldRoot(mark)?.querySelector('select')};
    });
    const ready = requested.filter(item => item.value && (!item.browser || item.shown));
    if (!ready.length) throw new Error('请先在原报销页的首条费用事项填写公共字段。');
    const written = [];
    const pending = [];
    for (const item of requested.filter(item => !ready.includes(item))) pending.push(`首行待补${item.label}；本次未复制该字段。`);
    for (const row of state.rows.slice(1)) {
      for (const item of ready) {
        const mark = `${state.fields[item.key]}_${row}`;
        const old = valueInfo(state.form, mark, true);
        if (old.value === item.value && (!item.browser || normalizeLabel(display(mark)) === normalizeLabel(item.shown))) continue;
        try {
          setValue(state.form, mark, {value: item.value, ...(item.browser ? {specialobj: item.specialobj} : {})});
          await waitUntil(() => String(state.form.getFieldValue(mark) || '') === item.value, `系统未接受首行的${item.label}`, 1500);
          if (item.browser) await waitUntil(() => normalizeLabel(display(mark)) === normalizeLabel(item.shown), `系统未显示首行的${item.label}`, 1500);
          written.push({row, position: state.allRows.indexOf(row) + 1, field: item.key, label: display(mark)});
          const entry = owned.get(row);
          if (entry?.values && Object.hasOwn(entry.values, item.key)) entry.values[item.key] = String(state.form.getFieldValue(mark) || '');
        } catch (error) {
          if (String(state.form.getFieldValue(mark) || '') !== old.value) {
            try { setValue(state.form, mark, old); }
            catch (restoreError) { throw new Error(`第 ${state.allRows.indexOf(row) + 1} 行${item.label}未能恢复，请核对原页面：${restoreError.message}`); }
            if (String(state.form.getFieldValue(mark) || '') !== old.value) throw new Error(`第 ${state.allRows.indexOf(row) + 1} 行${item.label}未能恢复，请核对原页面。`);
          }
          pending.push(`第 ${state.allRows.indexOf(row) + 1} 行${item.label}未复制：${error.message}`);
        }
      }
    }
    if (written.length) lastUndo = null;
    const after = firstRowState();
    return {...after, written, pending, message: `已从第 ${after.sourcePosition} 行复制到其余 ${state.rows.length - 1} 条费用事项；成功填写 ${written.length} 个单元格，${pending.length} 个待补。未保存或提交。`};
  }

  function signature(snapshot) {
    return JSON.stringify({context: snapshot.context || '', workflowId: String(snapshot.workflowId ?? ''), attachmentAmount: String(snapshot.attachmentAmount ?? ''), dailyCategory: String(snapshot.dailyCategory ?? ''), days: String(snapshot.days ?? ''), descriptions: snapshot.descriptions || [], existingRoutes: snapshot.existingRoutes || [],
      invoices: snapshot.invoices.map(invoice => ({row: String(invoice.row), number: String(invoice.number), content: String(invoice.content), type: String(invoice.type), rate: String(invoice.rate), amount: String(invoice.amount), tax: String(invoice.tax), net: String(invoice.net ?? '')}))});
  }

  function fieldsUnchanged(form, row, values, fields) {
    return Object.entries(values).every(([key, value]) => String(form.getFieldValue(`${fields[key]}_${row}`) || '') === value);
  }

  function validateAmounts(plan, before) {
    const cents = text => {
      const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(text).normalize('NFKC').trim().replace(/^[¥￥]\s*/, '').replace(/\s*元$/, '').replace(/,/g, ''));
      if (!match) throw new Error('原发票金额无效，请重新计算。');
      const value = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
      if (!Number.isSafeInteger(value)) throw new Error('金额超出可精确计算范围。');
      return match[1] ? -value : value;
    };
    const source = new Map(before.invoices.map(invoice => [String(invoice.row), invoice]));
    const used = new Set();
    const keys = new Set();
    const attachment = before.workflowId === '232' && String(before.attachmentAmount || '').trim() ? cents(before.attachmentAmount) : 0;
    if (attachment < 0) throw new Error('附件发票金额无效，请重新计算。');
    let attachmentUsed = false;
    for (const group of plan.groups) {
      if (group.key !== `${group.category}|${group.property}|${group.rate}|${group.kind}${before.workflowId === '232' ? `|${group.smallCategory || ''}` : ''}` || keys.has(group.key)) throw new Error('费用事项分组重复或无效，请重新计算。');
      keys.add(group.key);
      if (group.source === 'travelAllowance') {
        const days = String(before.days || '').trim();
        const amount = Number(days) * 6000;
        if (before.workflowId !== '230' || group.key !== '其他|其他|0%|出差补助' || !/^\d+$/.test(days) || Number(days) <= 0 || !Number.isSafeInteger(amount) ||
            group.amountCents !== amount || group.taxCents !== 0 || group.invoices?.length) throw new Error('出差补助与当前出差天数不一致，请重新计算。');
        continue;
      }
      let amount = 0; let tax = 0;
      if (group.attachmentAmountCents != null) {
        if (before.workflowId !== '232' || attachment <= 0 || attachmentUsed || group.key !== `其他|普票|0%|通用|${group.smallCategory || ''}` || group.attachmentAmountCents !== attachment) throw new Error('附件发票金额与普票分组不一致，请重新计算。');
        amount = attachment;
        attachmentUsed = true;
      }
      if (!group.invoices?.length && group.attachmentAmountCents == null) throw new Error('费用事项没有对应发票。');
      for (const item of group.invoices) {
        const row = String(item.row); const invoice = source.get(row);
        if (!invoice || used.has(row) || String(item.number) !== invoice.number) throw new Error('费用事项有遗漏或重复发票，请重新计算。');
        const type = String(invoice.type || '').normalize('NFKC');
        const content = String(invoice.content || '').normalize('NFKC');
        const taxi = /电子打车票/.test(type) ||
          (/电子/.test(type) && /普通|普票/.test(type) &&
            ((/滴滴|Didi/i.test(`${type} ${content}`) && /打车|滴滴|Didi|客运|旅客运输|出租车|网约车/i.test(`${type} ${content}`)) ||
              (/客运服务费/.test(content) && /^0*3(?:\.0+)?%?$/.test(String(invoice.rate || '').normalize('NFKC').replace(/\s/g, '')))));
        const property = ['231', '232'].includes(before.workflowId) && /普通|普票/.test(type) ? '普票' : /专用|专票/.test(type) ? '专票' : /铁路电子客票|火车票/.test(type) ? '火车票' : taxi ? '电子打车票' :
          /普通|普票/.test(type) && /机票|航空旅客人身意外伤害保险/.test(content) ? '机票' : '普票';
        const rawRate = String(invoice.rate || '').normalize('NFKC').replace(/\s/g, '');
        const match = /^(\d{1,2}(?:\.\d{1,4})?|100(?:\.0{1,4})?)%?$/.exec(rawRate);
        const invoiceRate = match ? `${Number(match[1])}%` : rawRate;
        const expenseRate = property === '火车票' ? `${invoiceRate}-计算抵扣` : ['普票', '机票', '其他'].includes(property) ? '0%' : invoiceRate;
        const kind = ['231', '232'].includes(before.workflowId) || group.category !== '交通' ? '通用' : property === '电子打车票' ? '打车' : property === '火车票' ? '火车' : property === '机票' ? '机票' :
          /汽油|柴油|燃油|加油/.test(content) ? '燃油' : /机票|航空运输|飞机票/.test(content) ? '机票' :
          /租车|代驾/.test(content) ? '租车代驾' : /出行服务/.test(content) ? '出行服务' : '其他交通';
        const category = before.workflowId === '232' ? '其他' : before.workflowId === '231' ? (property === '普票' ? (/餐饮|餐费|餐食|就餐|用餐|饮食服务/.test(content) ? '餐费' : '其他') :
          /住宿|客房|房费|宾馆|旅馆|酒店住宿/.test(content) ? '住宿' : /餐饮|餐费|餐食|就餐|用餐|饮食服务/.test(content) ? '餐费' :
          /汽油|柴油|燃油|加油|停车|泊车|过路|通行费|高速公路|ETC|客运|旅客运输|铁路|火车|高铁|动车|机票|航空运输|飞机票|出租车|网约车|打车|租车|代驾|出行服务|交通运输|公交|地铁|轮渡/.test(content) ? '交通' : '其他') : group.category;
        if (group.category !== category || group.property !== property || group.rate !== expenseRate || group.kind !== kind) throw new Error('分组内容、票种或抵扣税率与原发票不一致，请重新计算。');
        used.add(row); amount += cents(invoice.amount); tax += ['普票', '机票', '其他'].includes(property) ? 0 : cents(invoice.tax);
        if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(tax)) throw new Error('汇总金额超出可精确计算范围。');
      }
      if (amount !== group.amountCents || tax !== group.taxCents) throw new Error('分组报销金额或可抵扣税额与原发票不一致，请重新计算。');
    }
    if (plan.automatic) {
      for (const item of plan.skippedInvoices || []) {
        const row = String(item.row);
        if (!source.has(row) || used.has(row) || !item.issues?.length) throw new Error('跳过发票记录无效，请重新计算。');
        used.add(row);
      }
    }
    if (used.size !== source.size) throw new Error('费用事项未包含当前全部发票，请重新计算。');
    if (attachment > 0 && !attachmentUsed) throw new Error('费用事项遗漏附件发票金额，请重新计算。');
  }

  async function applyAutomatic(plan) {
    const form = api();
    if (typeof form.changeFieldValue !== 'function' || typeof form.addDetailRow !== 'function' || typeof form.delDetailRow !== 'function') throw new Error('系统表单接口不完整，暂不能填写。');
    const before = snapshot();
    if (signature(before) !== plan?.signature) throw new Error('来源数据已变化，请重新点击新建费用事项。');
    if (!plan.automatic || !plan.ready || !plan.groups?.length) throw new Error('没有有效发票，未覆盖原费用事项。');
    if (plan.groups.some(group => !LABELS[group.category] || !['普票', '专票', '电子打车票', '火车票', '机票', '其他'].includes(group.property) || !Number.isSafeInteger(group.amountCents) || !Number.isSafeInteger(group.taxCents))) throw new Error('费用事项数据无效。');
    validateAmounts(plan, before);
    const fields = before.fields;
    const controlled = Object.keys(fields).filter(key => !['department', 'costCenter'].includes(key));
    const pending = [];
    const skippedGroups = [];
    const written = [];
    const used = new Set();
    const rowKey = row => owned.get(row.row)?.key || `${fields.category ? Object.keys(LABELS).find(key => normalizeLabel(display(`${fields.category}_${row.row}`)) === normalizeLabel(LABELS[key])) || '' : ''}|${display(`${fields.property}_${row.row}`)}|${display(`${fields.rate}_${row.row}`).replace(/(\d+)\.0+%$/, '$1%')}`;
    const clear = row => {
      for (const key of controlled) setValue(form, `${fields[key]}_${row}`, {value: '', ...(['smallCategory', 'departure', 'arrival'].includes(key) ? {specialobj: []} : {})});
    };
    const text = cents => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
    // Capture all labels before touching any row; matching does not use row order.
    const existingKeys = new Map(before.existing.map(row => [row.row, rowKey(row)]));
    lastUndo = null;
    if (before.workflowId === '232') {
      if (plan.dailyBigCategory) {
        try {
          if (normalizeLabel(display('field21214')) !== normalizeLabel(plan.dailyBigCategory)) {
            await selectLabel(form, 'field21214', [plan.dailyBigCategory], true);
            await waitStable(() => indexes(form, 'detail_1').map(row => display(`${fields.smallCategory}_${row}`)), '费用大类与小类选项', 400);
          }
        } catch (error) { pending.push(`待补费用大类（${plan.dailyBigCategory}：${error.message}）`); }
      } else pending.push('待补费用大类：发票用途不同或无法识别，请在原页面核对后选择。');
    }
    for (const group of plan.groups) {
      const label = `${group.category} / ${group.kind} / ${group.property} / ${group.rate}`;
      let row = before.existing.find(item => !used.has(item.row) && existingKeys.get(item.row) === group.key)?.row;
      if (row == null) row = before.existing.find(item => !used.has(item.row) && !owned.has(item.row) &&
        existingKeys.get(item.row) === `${fields.category ? group.category : ''}|${group.property}|${group.rate}` && item.values.amount === text(group.amountCents))?.row;
      if (row == null) row = before.existing.find(item => !used.has(item.row) && controlled.every(key => !item.values[key]) && !item.values.department && !item.values.costCenter)?.row;
      let created = false;
      const groupPending = [];
      const preserved = row == null ? null : Object.fromEntries(['department', 'costCenter'].map(key => [key, valueInfo(form, `${fields[key]}_${row}`, true)]));
      try {
        if (row == null) {
          const previous = new Set(indexes(form, 'detail_1'));
          form.addDetailRow('detail_1', {});
          row = await waitUntil(() => indexes(form, 'detail_1').find(index => !previous.has(index)), '新增费用事项失败');
          created = true;
          await waitUntil(() => fieldRoot(`${fields.property}_${row}`), '新增费用事项尚未加载');
        }
        used.add(row);
        clear(row);
        const mark = key => `${fields[key]}_${row}`;
        for (const [key, value] of [['smallCategory', before.workflowId === '232' ? group.smallCategory : '国内差旅费'], ['departure', plan.trip.departure], ['arrival', plan.trip.arrival]].filter(([key]) => fields[key])) {
          try {
            if (!value) throw new Error('未识别');
            await selectLabel(form, mark(key), key === 'smallCategory' && before.workflowId === '230' ? ['国内差旅费', '国内差旅'] : [value], true);
          } catch (error) {
            setValue(form, mark(key), {value: '', specialobj: []});
            groupPending.push(`${label}：待补${{smallCategory: '费用小类', departure: '出发城市', arrival: '到达城市'}[key]}（${error.message}）`);
          }
        }
        if (fields.days) {
          if (/^\d+$/.test(plan.trip.days) && Number(plan.trip.days) > 0) setValue(form, mark('days'), {value: plan.trip.days});
          else groupPending.push(`${label}：待补停留天数`);
        }
        if (fields.category) await selectLabel(form, mark('category'), [LABELS[group.category]]);
        await selectLabel(form, mark('property'), [group.property]);
        await waitStable(() => ({property: form.getFieldValue(mark('property')), rates: choices(mark('rate'))}), '发票属性与税率选项', 400);
        const rateLabels = /^\d+(?:\.\d+)?%$/.test(group.rate) ? [group.rate, `${Number(group.rate.replace('%', ''))}.00%`, group.rate.replace('%', '')] : [group.rate];
        await selectLabel(form, mark('rate'), rateLabels);
        const expected = Object.fromEntries(['category', 'property', 'rate'].filter(key => fields[key]).map(key => [key, String(form.getFieldValue(mark(key)) || '')]));
        await waitStable(() => controlled.map(key => form.getFieldValue(mark(key))), '费用事项', 700);
        setValue(form, mark('amount'), {value: text(group.amountCents)});
        setValue(form, mark('tax'), {value: text(group.taxCents)});
        await waitStable(() => controlled.map(key => form.getFieldValue(mark(key))), '金额与税额', 700);
        if (String(form.getFieldValue(mark('amount'))) !== text(group.amountCents) || String(form.getFieldValue(mark('tax'))) !== text(group.taxCents)) throw new Error('系统联动改变了金额或税额');
        if (Object.entries(expected).some(([key, value]) => !value || String(form.getFieldValue(mark(key)) || '') !== value)) throw new Error('系统联动改变了分类、票种或票面税率');
        if (preserved) for (const [key, info] of Object.entries(preserved)) {
          if (String(form.getFieldValue(mark(key)) || '') !== info.value) setValue(form, mark(key), info);
          if (String(form.getFieldValue(mark(key)) || '') !== info.value) throw new Error('系统未能保留费用部门或成本中心');
        }
        for (const key of ['department', 'costCenter']) if (!form.getFieldValue(mark(key))) groupPending.push(`${label}：待补${key === 'department' ? '费用部门' : '成本中心'}`);
        pending.push(...groupPending);
        written.push({row, key: group.key, amountCents: group.amountCents, values: Object.fromEntries(controlled.map(key => [key, String(form.getFieldValue(mark(key)) || '')]))});
      } catch (error) {
        skippedGroups.push({key: group.key, invoices: group.invoices.map(item => item.number), reason: error.message});
        pending.push(`未填写 ${label}（发票 ${group.invoices.map(item => item.number).join('、')}）：${error.message}`);
        if (row != null) {
          try {
            if (created) {
              form.delDetailRow('detail_1', row);
              await waitUntil(() => !indexes(form, 'detail_1').includes(row), '失败行未能移除');
            } else clear(row);
          } catch (cleanup) { throw new Error(`已填入 ${written.length} 组；失败事项未能清理，请核对原页面：${cleanup.message}`); }
        }
      }
    }
    for (const item of before.existing.filter(item => !used.has(item.row))) {
      if (item.values.department || item.values.costCenter) {
        clear(item.row);
        pending.push(`原第 ${Number(item.row) + 1} 行无法匹配新分组，已清空旧费用，保留费用部门 ${item.values.department || '空'}、成本中心 ${item.values.costCenter || '空'}，请人工核对该行。`);
      } else {
        form.delDetailRow('detail_1', item.row);
        await waitUntil(() => !indexes(form, 'detail_1').includes(item.row), '旧费用事项未能移除');
      }
    }
    owned.clear();
    for (const item of written) owned.set(item.row, {key: item.key, values: item.values});
    const finalRows = indexes(form, 'detail_1');
    return {ok: true, rows: written.map(item => item.row), writtenGroups: written.map(item => ({key: item.key, row: item.row, position: finalRows.indexOf(item.row) + 1})), pending, skippedGroups,
      message: `已填入 ${written.length} 条费用事项，金额 ${text(written.reduce((sum, item) => sum + item.amountCents, 0))} 元；跳过 ${plan.skippedInvoices.length} 张发票、${skippedGroups.length} 个分组。未保存或提交。`};
  }

  async function apply(plan) {
    const form = api();
    if (typeof form.changeFieldValue !== 'function' || typeof form.addDetailRow !== 'function' || typeof form.delDetailRow !== 'function') throw new Error('系统表单接口不完整，暂不能填写。');
    const before = snapshot();
    if (signature(before) !== plan.signature) throw new Error('发票、事前申请或出差天数已变化，请重新读取计算。');
    if (!Array.isArray(plan.groups) || !plan.groups.length || plan.errors?.length || !plan.ready) throw new Error('请先完成计算并处理所有待填写项。');
    if (!/^\d+$/.test(plan.trip?.days || '') || Number(plan.trip.days) <= 0 || !plan.trip.departure || !plan.trip.arrival) throw new Error('城市或停留天数不完整。');
    if (plan.groups.some(group => !LABELS[group.category] || !['普票', '专票', '电子打车票', '火车票', '机票', '其他'].includes(group.property) || !Number.isSafeInteger(group.amountCents) || !Number.isSafeInteger(group.taxCents))) throw new Error('费用事项数据无效。');
    validateAmounts(plan, before);
    const fields = before.fields;
    const controlled = Object.keys(fields).filter(key => !['department', 'costCenter'].includes(key));
    const templateKeys = new Set(['smallCategory', 'departure', 'arrival', 'department', 'costCenter']);
    const isTemplate = row => Object.entries(row.values).every(([key, value]) => templateKeys.has(key) || value === '');
    const manual = before.existing.filter(row => !row.owned && !isTemplate(row));
    if (manual.length) throw new Error('费用事项已有人工填写内容。为避免重复报销，请先在原页面核对并清理，插件不会覆盖这些行。');
    for (const row of before.existing.filter(row => row.owned)) {
      if (!fieldsUnchanged(form, row.row, owned.get(row.row).values, fields)) throw new Error('你已修改插件生成的事项，请先核对原页面；此次不会覆盖。');
    }
    const obsolete = before.existing.filter(row => row.owned && !plan.groups.some(group => group.key === owned.get(row.row).key));
    if (obsolete.some(row => row.values.department || row.values.costCenter)) throw new Error('需要移除的旧分组已有费用部门或成本中心，请先在原页面处理，避免丢失手填内容。');
    const undo = {context: before.context, fields, before: new Map(), created: [], removed: [], ownership: new Map(owned)};
    const used = new Set();
    const written = [];
    const centsText = value => `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
    try {
      for (const group of plan.groups) {
        const matched = before.existing.find(row => row.owned && owned.get(row.row).key === group.key);
        let row = matched?.row;
        if (row == null) row = before.existing.find(candidate => !used.has(candidate.row) && !candidate.owned && isTemplate(candidate))?.row;
        if (row == null) {
          const previous = new Set(indexes(form, 'detail_1'));
          form.addDetailRow('detail_1', {});
          row = await waitUntil(() => indexes(form, 'detail_1').find(index => !previous.has(index)), '新增费用事项失败');
          undo.created.push(row);
          await waitUntil(() => fieldRoot(`${fields.category}_${row}`), '新增费用事项尚未加载');
        } else {
          undo.before.set(row, Object.fromEntries(controlled.map(key => [key, valueInfo(form, `${fields[key]}_${row}`, ['smallCategory', 'departure', 'arrival'].includes(key))])));
        }
        used.add(row);
        const mark = key => `${fields[key]}_${row}`;
        await selectLabel(form, mark('smallCategory'), ['国内差旅费', '国内差旅'], true);
        await selectLabel(form, mark('departure'), [plan.trip.departure], true);
        await selectLabel(form, mark('arrival'), [plan.trip.arrival], true);
        setValue(form, mark('days'), {value: String(plan.trip.days)});
        await selectLabel(form, mark('category'), [LABELS[group.category]]);
        await selectLabel(form, mark('property'), [group.property]);
        // The production form changes rate choices when invoice property changes.
        await waitStable(() => ({property: form.getFieldValue(mark('property')), rates: choices(mark('rate'))}), '发票属性与税率选项', 400);
        const rateLabels = /^\d+(?:\.\d+)?%$/.test(group.rate) ? [group.rate, `${Number(group.rate.replace('%', ''))}.00%`, group.rate.replace('%', '')] : [group.rate];
        await selectLabel(form, mark('rate'), rateLabels);
        await waitStable(() => controlled.map(key => form.getFieldValue(mark(key))), '费用事项', 700);
        setValue(form, mark('amount'), {value: centsText(group.amountCents)});
        setValue(form, mark('tax'), {value: centsText(group.taxCents)});
        await waitStable(() => controlled.map(key => form.getFieldValue(mark(key))), '金额与税额', 700);
        if (String(form.getFieldValue(mark('amount'))) !== centsText(group.amountCents) || String(form.getFieldValue(mark('tax'))) !== centsText(group.taxCents)) throw new Error('系统联动改变了金额或税额，已停止填写。');
        written.push({row, key: group.key, values: Object.fromEntries(controlled.map(key => [key, String(form.getFieldValue(mark(key)) || '')]))});
      }
      for (const row of obsolete) {
        const values = Object.fromEntries(controlled.map(key => [key, valueInfo(form, `${fields[key]}_${row}`, ['smallCategory', 'departure', 'arrival'].includes(key))]));
        undo.removed.push({row: row.row, values});
        form.delDetailRow('detail_1', row.row);
        await waitUntil(() => !indexes(form, 'detail_1').includes(row.row), '旧分组未能移除');
        owned.delete(row.row);
      }
      for (const row of written) owned.set(row.row, {key: row.key, values: row.values});
      lastUndo = undo;
      return {ok: true, rows: written.map(row => row.row), message: `已填入 ${written.length} 条费用事项；请补充费用部门和成本中心。未保存或提交。`};
    } catch (error) {
      const failures = await restore(form, undo, false);
      owned.clear(); for (const [row, value] of undo.ownership) owned.set(row, value);
      // A partial restoration must be surfaced rather than reported as a clean rollback.
      throw new Error(`${error.message}${failures.length ? `；部分字段未能恢复：${failures.join('；')}，请核对原页面。` : '；本次填写已回退。'}`);
    }
  }

  async function restore(form, undo, userUndo) {
    const failures = [];
    if (userUndo) {
      for (const row of [...undo.created, ...undo.before.keys()]) {
        const entry = owned.get(row);
        if (!entry || !fieldsUnchanged(form, row, entry.values, undo.fields)) throw new Error('生成事项已被手动修改，不能自动撤销；请在原页面核对。');
        if (undo.created.includes(row) && ['department', 'costCenter'].some(key => form.getFieldValue(`${undo.fields[key]}_${row}`))) throw new Error('新事项已有手填部门或成本中心，不能自动删除。');
      }
    }
    for (const row of undo.created) {
      try { if (indexes(form, 'detail_1').includes(row)) { form.delDetailRow('detail_1', row); await waitUntil(() => !indexes(form, 'detail_1').includes(row), '新增行未能移除'); } }
      catch (error) { failures.push(error.message); }
    }
    for (const [row, values] of undo.before) {
      try { for (const [key, info] of Object.entries(values)) form.changeFieldValue(`${undo.fields[key]}_${row}`, info); }
      catch (error) { failures.push(error.message); }
    }
    for (const removed of undo.removed) {
      try {
        const old = new Set(indexes(form, 'detail_1'));
        form.addDetailRow('detail_1', Object.fromEntries(Object.entries(removed.values).map(([key, info]) => [undo.fields[key], info])));
        const newRow = await waitUntil(() => indexes(form, 'detail_1').find(row => !old.has(row)), '旧分组未能恢复');
        const entry = undo.ownership.get(removed.row);
        undo.ownership.delete(removed.row);
        if (entry) undo.ownership.set(newRow, entry);
      } catch (error) { failures.push(error.message); }
    }
    return failures;
  }

  async function undoApply() {
    const form = api();
    if (!lastUndo) throw new Error('本页面没有可撤销的插件填写。');
    if (context(form) !== lastUndo.context) throw new Error('已切换报销单，不能撤销上一个页面的填写。');
    const failures = await restore(form, lastUndo, true);
    if (failures.length) throw new Error(`撤销未完全成功，请核对原页面：${failures.join('；')}`);
    owned.clear(); for (const [row, value] of lastUndo.ownership) owned.set(row, value);
    lastUndo = null;
    return {ok: true, message: '已撤销最近一次插件填写，保留原有内容。'};
  }

  window.JdlExpenseAdapter = {
    version: '0.2.9',
    async run(command, payload) {
      if (busy) return {ok: false, error: '正在处理，请等待本次操作完成。'};
      busy = true;
      try {
        if (command === 'read') return {ok: true, snapshot: snapshot()};
        if (command === 'firstRowState') return firstRowState();
        if (command === 'applyFirstRow') return await applyFirstRow(payload);
        if (command === 'apply') return await apply(payload);
        if (command === 'automatic') return await applyAutomatic(payload);
        if (command === 'undo') return await undoApply();
        return {ok: false, error: '不支持的操作。'};
      } catch (error) { return {ok: false, error: error.message}; }
      finally { busy = false; }
    }
  };
})();
