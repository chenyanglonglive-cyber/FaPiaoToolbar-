export const CATEGORIES = ['交通', '住宿', '餐费', '其他'];
export const CATEGORY_LABELS = {交通: '交通费', 住宿: '住宿费', 餐费: '餐费', 其他: '其他费用'};
export const DAILY_TRAVEL_ALLOWANCE_CENTS = 6000;
export const EXPENSE_PROPERTIES = ['普票', '专票', '电子打车票', '火车票', '机票', '其他'];

const RULES = [
  ['交通', /汽油|柴油|燃油|加油|停车|泊车|过路|通行费|高速公路|ETC|客运|旅客运输|铁路|火车|高铁|动车|机票|航空运输|航空旅客人身意外伤害保险|飞机票|出租车|网约车|打车|租车|代驾|出行服务|交通运输|公交|地铁|轮渡/i],
  ['住宿', /住宿|客房|房费|宾馆|旅馆|酒店住宿|住宿服务/],
  ['餐费', /餐饮|餐费|餐食|就餐|用餐|饮食服务|餐饮服务/]
];

export function classify(content) {
  const text = String(content ?? '').normalize('NFKC');
  const hits = RULES.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  if (hits.length === 1) return {category: hits[0], reason: '按发票内容识别', review: false};
  if (hits.length > 1) return {category: '其他', reason: `内容涉及${hits.join('、')}，请核对分类`, review: true};
  return {category: '其他', reason: '不属于交通、住宿、餐费，归入其他', review: false};
}

export function classifyDailyPurpose(content, selectedCategory = '') {
  const text = String(content ?? '').normalize('NFKC');
  const welfare = /员工福利|福利费|团建|生日蛋糕|员工餐|员工食堂|节日礼品|慰问品|慰问金/;
  const office = /办公用品|文具|装订|复印|打印|纸制品|快递费|邮寄|计算机外部设备|U盘|光驱|办公耗材/;
  const welfareHit = welfare.test(text);
  const officeHit = office.test(text);
  if (welfareHit && !officeHit) return {bigCategory: '薪酬福利', smallCategory: '福利费', reason: '按发票内容识别员工福利'};
  if (officeHit && !welfareHit) return {bigCategory: '日常费用', smallCategory: '日常办公费', reason: '按发票内容识别日常办公'};
  if (welfareHit && officeHit) return {bigCategory: '', smallCategory: '', reason: '发票内容同时涉及办公与福利'};
  if (selectedCategory === '薪酬福利') return {bigCategory: '薪酬福利', smallCategory: '福利费', reason: '内容未明确；沿用本单已选薪酬福利'};
  if (selectedCategory === '日常费用') return {bigCategory: '', smallCategory: '', reason: '无法从发票内容确定日常费用小类'};
  return {bigCategory: '', smallCategory: '', reason: '无法从发票内容确定费用大类和小类'};
}

export function isDidiTaxiTicket(type, content, rate) {
  const ticketType = String(type ?? '').normalize('NFKC');
  const detail = String(content ?? '').normalize('NFKC');
  const electronic = /电子/.test(ticketType);
  const ordinary = /普通|普票/.test(ticketType);
  const explicitTaxi = /电子打车票/.test(ticketType) || (electronic && ordinary && /滴滴|Didi/i.test(`${ticketType} ${detail}`) && /打车|滴滴|Didi|客运|旅客运输|出租车|网约车/i.test(`${ticketType} ${detail}`));
  const passengerService = electronic && ordinary && /客运服务费/.test(detail) && /^0*3(?:\.0+)?%?$/.test(String(rate ?? '').normalize('NFKC').replace(/\s/g, ''));
  return explicitTaxi || passengerService;
}

export function invoiceProperty(type, content = '', rate = '') {
  const text = String(type ?? '').normalize('NFKC').trim();
  const detail = String(content ?? '').normalize('NFKC');
  if (/专用|专票/.test(text)) return {property: '专票', reason: '专用发票'};
  if (/铁路电子客票|火车票/.test(text)) return {property: '火车票', reason: '铁路电子客票按票面税率计算抵扣'};
  if (isDidiTaxiTicket(type, content, rate)) return {property: '电子打车票', reason: '电子普通发票的客运服务费且税率3%，或明确标识电子打车票'};
  if (/普通|普票/.test(text) && /机票|航空旅客人身意外伤害保险/.test(detail)) return {property: '机票', reason: '机票款及对应航空旅客保险按系统机票项归集'};
  if (/普通|普票/.test(text)) return {property: '普票', reason: '普通发票'};
  if (/火车票|铁路电子客票|机票|航空.*行程单|出租车.*票|电子打车票|ETC.*票/.test(text)) {
    return {property: '普票', reason: '按非专票归入普票；请核对原始票种'};
  }
  return {property: '', reason: '无法确定普票或专票，请在发票清单中选择'};
}

export function expenseKind(content, category, property) {
  if (category !== '交通') return '通用';
  if (property === '电子打车票') return '打车';
  if (property === '火车票') return '火车';
  if (property === '机票') return '机票';
  const text = String(content ?? '').normalize('NFKC');
  if (/汽油|柴油|燃油|加油/.test(text)) return '燃油';
  if (/机票|航空运输|飞机票/.test(text)) return '机票';
  if (/租车|代驾/.test(text)) return '租车代驾';
  if (/出行服务/.test(text)) return '出行服务';
  return '其他交通';
}

export function toCents(value, label = '金额') {
  let text = String(value ?? '').normalize('NFKC').trim();
  text = text.replace(/^[¥￥]\s*/, '').replace(/\s*元$/, '').replace(/,/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`${label}不是有效的两位小数金额：${text || '空值'}`);
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}超出可精确计算范围`);
  return Number(match[1] ? -cents : cents);
}

export function money(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出可精确计算范围');
  const negative = cents < 0;
  const value = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function normalizeRate(value) {
  const text = String(value ?? '').normalize('NFKC').replace(/\s/g, '');
  if (/^(免税|不征税)$/.test(text)) return text;
  const match = /^(\d{1,2}(?:\.\d{1,4})?|100(?:\.0{1,4})?)%?$/.exec(text);
  if (!match) throw new Error(`税率无法识别：${text || '空值'}`);
  const number = Number(match[1]);
  // A bare fractional rate could mean a ratio or a percentage. Do not guess.
  if (!text.endsWith('%') && number > 0 && number < 1) throw new Error(`税率 ${text} 缺少百分号，请核对`);
  return `${number}%`;
}

export function extractRoute(descriptions) {
  const routes = [];
  for (const description of descriptions || []) {
    const text = String(description).normalize('NFKC');
    const pattern = /(?:^|[\s,，;；:：。])(?:从)?([\u4e00-\u9fa5]{2,12}?)\s*(?:到|至|→|->)\s*([\u4e00-\u9fa5]{2,12})(?=$|[\s,，;；。])/g;
    for (const match of text.matchAll(pattern)) routes.push({departure: match[1], arrival: match[2]});
  }
  const unique = [...new Map(routes.map(route => [JSON.stringify(route), route])).values()];
  if (unique.length === 1) return {...unique[0], reason: '从事前申请费用说明提取'};
  return {departure: '', arrival: '', reason: unique.length ? '费用说明中有多个城市组合，请指定本单城市' : '未找到“上海到深圳”格式的行程，请补充城市'};
}

function addSafe(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('汇总金额超出可精确计算范围');
  return result;
}

// The source fingerprint excludes deletion checkboxes and includes travel context.
export function sourceSignature(snapshot) {
  return JSON.stringify({
    context: snapshot.context || '',
    workflowId: String(snapshot.workflowId ?? ''),
    attachmentAmount: String(snapshot.attachmentAmount ?? ''),
    dailyCategory: String(snapshot.dailyCategory ?? ''),
    days: String(snapshot.days ?? ''),
    descriptions: snapshot.descriptions || [],
    existingRoutes: snapshot.existingRoutes || [],
    invoices: (snapshot.invoices || []).map(invoice => ({
      row: String(invoice.row), number: String(invoice.number), content: String(invoice.content),
      type: String(invoice.type), rate: String(invoice.rate), amount: String(invoice.amount),
      tax: String(invoice.tax), net: String(invoice.net ?? '')
    }))
  });
}

export function calculate(snapshot, overrides = {}, trip = {}) {
  const hospitality = String(snapshot.workflowId) === '231';
  const daily = String(snapshot.workflowId) === '232';
  const nonTravel = hospitality || daily;
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const invoices = [];
  const groups = new Map();
  const dailySelectedCategory = String(snapshot.dailyCategory || '').trim();
  let attachmentAmountCents = 0;
  if (daily && String(snapshot.attachmentAmount ?? '').trim()) {
    try {
      attachmentAmountCents = toCents(snapshot.attachmentAmount, '附件发票金额');
      if (attachmentAmountCents < 0) errors.push('附件发票金额不能为负数，请在原页面核对。');
    } catch (error) { errors.push(error.message); }
  }
  if (!snapshot.invoices?.length && attachmentAmountCents <= 0) errors.push('当前表格没有发票，请先在报销页面添加发票。');
  for (const raw of snapshot.invoices || []) {
    const id = String(raw.row);
    const override = overrides[id] || {};
    const detected = classify(raw.content);
    const originalProperty = nonTravel && /普通|普票/.test(String(raw.type ?? '').normalize('NFKC'))
      ? {property: '普票', reason: '当前报销单的普通发票不抵扣税额'} : invoiceProperty(raw.type, raw.content, raw.rate);
    const category = override.category || (daily ? '其他' : hospitality && originalProperty.property === '普票'
      ? (detected.category === '餐费' ? '餐费' : '其他') : detected.category);
    const property = override.property || originalProperty.property;
    const kind = nonTravel ? '通用' : expenseKind(raw.content, category, property);
    const purpose = daily ? classifyDailyPurpose(raw.content, dailySelectedCategory) : null;
    const item = {...raw, id, category, property, kind, reason: override.category ? '人工调整分类' : detected.reason,
      propertyReason: override.property ? '人工确认发票属性' : originalProperty.reason, review: daily ? false : detected.review,
      bigCategory: purpose?.bigCategory || '', smallCategory: purpose?.smallCategory || '', purposeReason: purpose?.reason || '', issues: []};
    const number = String(raw.number ?? '').trim();
    if (!number) item.issues.push('缺少发票号码');
    if (seen.has(number) && number) item.issues.push('发票号码重复，请先核对或移除重复发票');
    seen.add(number);
    if (!String(raw.content ?? '').trim()) item.issues.push('缺少发票内容');
    if (!CATEGORIES.includes(category)) item.issues.push('费用分类无效');
    if (!EXPENSE_PROPERTIES.includes(property)) item.issues.push(originalProperty.reason);
    try {
      if (daily && property === '专票' && String(raw.rate || '').includes(',') && !Array.isArray(raw.lines)) {
        throw new Error('多税率专票未提供可核对的逐项金额和税额，已跳过；请在发票详情中手工拆分。');
      }
      item.rate = daily && property === '普票' && String(raw.rate || '').includes(',')
        ? String(raw.rate).split(',').map(normalizeRate).join(',') : normalizeRate(raw.rate);
      item.amountCents = toCents(raw.amount, '价税合计');
      item.taxCents = toCents(raw.tax, '发票税额');
      item.netCents = item.amountCents - item.taxCents;
      item.expenseRate = property === '火车票' ? `${item.rate}-计算抵扣` : ['普票', '机票', '其他'].includes(property) ? '0%' : item.rate;
      item.deductibleTaxCents = ['普票', '机票', '其他'].includes(property) ? 0 : item.taxCents;
      item.expenseNetCents = item.amountCents - item.deductibleTaxCents;
      if ((item.amountCents >= 0 && (item.taxCents < 0 || item.taxCents > item.amountCents)) ||
          (item.amountCents < 0 && (item.taxCents > 0 || item.taxCents < item.amountCents))) item.issues.push('金额和税额的符号或大小不一致');
      if (raw.net !== '' && raw.net != null && Math.abs(toCents(raw.net, '未税金额') - item.netCents) > 1) item.issues.push('价税合计、税额、未税金额不一致');
    } catch (error) { item.issues.push(error.message); }
    if (item.review && !override.category) warnings.push(`发票 ${number}：${detected.reason}`);
    if (originalProperty.reason.startsWith('按非专票') && !override.property) warnings.push(`发票 ${number}：${originalProperty.reason}`);
    if (item.issues.length) errors.push(...item.issues.map(issue => `发票 ${number || `第${id}行`}：${issue}`));
    invoices.push(item);
    if (!item.issues.length) {
      const key = `${category}|${property}|${item.expenseRate}|${kind}${daily ? `|${item.smallCategory}` : ''}`;
      if (!groups.has(key)) groups.set(key, {key, category, property, rate: item.expenseRate, kind,
        bigCategory: item.bigCategory, smallCategory: item.smallCategory, amountCents: 0, taxCents: 0, netCents: 0, invoiceTaxCents: 0, invoices: []});
      const group = groups.get(key);
      group.amountCents = addSafe(group.amountCents, item.amountCents);
      group.taxCents = addSafe(group.taxCents, item.deductibleTaxCents);
      group.invoiceTaxCents = addSafe(group.invoiceTaxCents, item.taxCents);
      group.netCents = addSafe(group.netCents, item.expenseNetCents);
      group.invoices.push(item);
    }
  }
  const dailyPurposes = snapshot.dailyPurposeCategories || invoices.map(item => item.bigCategory);
  const dailyCategories = new Set(dailyPurposes.filter(Boolean));
  const dailyBigCategory = daily && dailyCategories.size === 1 && dailyPurposes.every(Boolean) ? [...dailyCategories][0]
    : daily && dailyPurposes.length === 0 && ['薪酬福利', '日常费用'].includes(dailySelectedCategory) ? dailySelectedCategory : '';
  if (daily && !dailyBigCategory) warnings.push(dailyCategories.size > 1 ? '发票内容涉及日常费用与薪酬福利；费用大类是整单字段，请人工选择并核对。' : '部分发票无法确定费用大类；请人工选择并核对。');
  if (daily) for (const group of groups.values()) if (!group.smallCategory) warnings.push(`费用分组 ${group.property} / ${group.rate}：待补费用小类（${group.invoices[0]?.purposeReason || '用途未识别'}）。`);
  if (daily && attachmentAmountCents > 0 && !errors.some(error => error.includes('附件发票金额'))) {
    const smallCategory = groups.size && dailyBigCategory === '薪酬福利' ? '福利费' : groups.size && dailyBigCategory === '日常费用' ? '日常办公费' : '';
    const key = `其他|普票|0%|通用|${smallCategory}`;
    if (!groups.has(key)) groups.set(key, {key, category: '其他', property: '普票', rate: '0%', kind: '通用',
      bigCategory: dailyBigCategory, smallCategory, amountCents: 0, taxCents: 0, netCents: 0, invoiceTaxCents: 0, invoices: []});
    const group = groups.get(key);
    group.attachmentAmountCents = attachmentAmountCents;
    group.amountCents = addSafe(group.amountCents, attachmentAmountCents);
    group.netCents = addSafe(group.netCents, attachmentAmountCents);
    warnings.push(`附件发票金额 ${money(attachmentAmountCents)} 元已并入普票 / 0%；附件票种未核实，请人工核对。`);
  }
  const route = nonTravel ? {departure: '', arrival: '', reason: ''} : extractRoute(snapshot.descriptions);
  const existingRoutes = [...new Map((snapshot.existingRoutes || []).filter(item => item.departure && item.arrival)
    .map(item => [JSON.stringify(item), item])).values()];
  if (!route.departure && existingRoutes.length === 1) {
    route.departure = existingRoutes[0].departure;
    route.arrival = existingRoutes[0].arrival;
    route.reason = '从当前费用事项读取一致的城市';
  }
  const departure = String(trip.departure ?? route.departure).trim();
  const arrival = String(trip.arrival ?? route.arrival).trim();
  const days = String(trip.days ?? snapshot.days ?? '').trim();
  const contextIssues = [];
  if (!nonTravel && (!departure || !arrival)) contextIssues.push(route.reason);
  if (!nonTravel && (!/^\d+$/.test(days) || Number(days) <= 0)) contextIssues.push('停留天数应为正整数，请核对基本信息。');
  const rateOrder = rate => /^\d/.test(rate) ? Number(rate.match(/^\d+(?:\.\d+)?/)?.[0]) : -1;
  const kindOrder = kind => ['打车', '火车', '燃油', '机票', '租车代驾', '出行服务', '其他交通', '通用', '出差补助'].indexOf(kind);
  const sorted = [...groups.values()].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
    kindOrder(a.kind) - kindOrder(b.kind) ||
    (a.smallCategory || '').localeCompare(b.smallCategory || '', 'zh-CN') ||
    EXPENSE_PROPERTIES.indexOf(a.property) - EXPENSE_PROPERTIES.indexOf(b.property) || rateOrder(b.rate) - rateOrder(a.rate) || a.rate.localeCompare(b.rate));
  const totals = sorted.reduce((total, group) => ({amountCents: addSafe(total.amountCents, group.amountCents), taxCents: addSafe(total.taxCents, group.taxCents), invoiceTaxCents: addSafe(total.invoiceTaxCents, group.invoiceTaxCents)}), {amountCents: 0, taxCents: 0, invoiceTaxCents: 0});
  return {
    id: globalThis.crypto?.randomUUID?.() || `calc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    calculatedAt: new Date().toISOString(), signature: sourceSignature(snapshot),
    invoices, groups: sorted, totals, errors, warnings, contextIssues,
    workflowId: String(snapshot.workflowId), attachmentAmountCents, dailyBigCategory,
    trip: {departure, arrival, days, smallCategory: daily ? '' : hospitality ? '' : '国内差旅'},
    sourceCount: invoices.length, ready: errors.length === 0 && contextIssues.length === 0,
    events: [{at: new Date().toISOString(), message: errors.length ? '计算完成，存在待处理数据' : '计算完成，已生成费用事项预览'}]
  };
}

// Automatic mode excludes every occurrence of a duplicate number and all
// ambiguous invoices, while keeping the complete source signature and audit.
export function calculateAutomatic(snapshot) {
  const initial = calculate(snapshot);
  const counts = new Map();
  for (const item of initial.invoices) {
    const number = String(item.number || '').trim();
    if (number) counts.set(number, (counts.get(number) || 0) + 1);
  }
  for (const item of initial.invoices) {
    if (counts.get(String(item.number || '').trim()) > 1 && !item.issues.some(issue => issue.includes('重复'))) item.issues.push('发票号码重复，请核对全部同号发票');
    if (item.review) item.issues.push('内容涉及多个费用分类，需人工确认');
  }
  const validRows = new Set(initial.invoices.filter(item => !item.issues.length).map(item => String(item.row)));
  const result = calculate({...snapshot, dailyPurposeCategories: initial.invoices.map(item => item.bigCategory),
    invoices: snapshot.invoices.filter(item => validRows.has(String(item.row)))});
  const days = String(snapshot.days ?? '').trim();
  if (String(snapshot.workflowId) === '230' && validRows.size && /^\d+$/.test(days) && Number(days) > 0) {
    const amountCents = Number(days) * DAILY_TRAVEL_ALLOWANCE_CENTS;
    if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(result.totals.amountCents + amountCents)) throw new Error('出差补助金额超出可精确计算范围');
    result.groups.push({key:'其他|其他|0%|出差补助', category:'其他', property:'其他', rate:'0%', kind:'出差补助', source:'travelAllowance',
      description:`出差补助：${days} 天 × 60 元/天`, amountCents, taxCents:0, netCents:amountCents, invoiceTaxCents:0, invoices:[]});
    result.totals.amountCents += amountCents;
  }
  result.signature = sourceSignature(snapshot);
  result.invoices = initial.invoices;
  result.sourceCount = initial.sourceCount;
  result.skippedInvoices = initial.invoices.filter(item => item.issues.length).map(item => ({row: String(item.row), number: item.number, issues: item.issues}));
  result.errors = result.skippedInvoices.flatMap(item => item.issues.map(issue => `跳过发票 ${item.number || `第${item.row}行`}：${issue}`));
  result.warnings = initial.warnings;
  if (String(snapshot.workflowId) === '232' && snapshot.existing?.some(row => String(row.values?.amount || '').trim())) {
    try {
      const currentCents = snapshot.existing.reduce((sum, row) => {
        const amount = String(row.values?.amount || '').trim();
        return amount ? addSafe(sum, toCents(amount, '原费用事项报销金额')) : sum;
      }, 0);
      const sourceCents = (snapshot.invoices || []).reduce((sum, invoice) => addSafe(sum, toCents(invoice.amount, '发票价税合计')), Math.max(0, result.attachmentAmountCents || 0));
      if (currentCents !== sourceCents) result.warnings.push(`原费用事项合计 ${money(currentCents)} 元，与全部发票及附件金额 ${money(sourceCents)} 元相差 ${money(currentCents - sourceCents)} 元；请核对原单，助手按有效来源金额填写。`);
    } catch (error) { result.warnings.push(`原费用事项金额无法核对：${error.message}`); }
  }
  result.errors.push(...initial.errors.filter(error => error.includes('附件发票金额')));
  result.automatic = true;
  result.ready = result.groups.length > 0 && !result.errors.some(error => error.includes('附件发票金额'));
  result.events = [{at: new Date().toISOString(), message: `自动计算完成：${validRows.size} 张有效发票，${result.skippedInvoices.length} 张跳过`}];
  return result;
}

export function expenseLedger(result) {
  return (result.groups || []).map((group, index) => {
    const written = result.writeOutcome?.writtenGroups?.find(item => item.key === group.key);
    const skipped = result.writeOutcome?.skippedGroups?.find(item => item.key === group.key);
    return {...group, number: index + 1,
      title: written ? `费用事项第 ${written.position} 行` : `费用分组 ${index + 1}`,
      status: written ? '已填入' : skipped ? '已跳过，未填入' : '未确认填写',
      reason: skipped?.reason || '',
      invoices: [
        ...group.invoices.map(item => ({number: item.number, content: item.content, amount: money(item.amountCents), tax: money(item.taxCents), deductibleTax: money(item.deductibleTaxCents), invoiceRate: item.rate})),
        ...(group.attachmentAmountCents ? [{number: '附件金额', content: '附件发票金额（票种未核实）', amount: money(group.attachmentAmountCents), tax: '未核实', deductibleTax: '0.00', invoiceRate: '未核实'}] : [])
      ]};
  });
}

export function logText(result) {
  const hospitality = result.workflowId === '231';
  const daily = result.workflowId === '232';
  const lines = ['佳利达 · 费用事项计算日志', `计算编号：${result.id}`,
    `计算时间：${new Date(result.calculatedAt).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}（北京时间）`,
    daily ? '发票范围：当前表格全部发票和附件发票金额；附件票种未核实，暂并入普票 / 0%' : '发票范围：当前表格全部发票；勾选仅用于移除，不参与筛选',
    daily ? '分组规则：日常费用单按费用小类、发票属性和抵扣税率归集；同一小类的普票合并为0%' : hospitality ? '分组规则：业务招待单普通发票按餐饮/非餐饮拆分；专票按发票内容、税率拆分' : '分组规则：分类 + 费用用途（打车/燃油/机票等）+ 费用事项发票属性 + 抵扣税率；城市不参与分组',
    daily ? '金额口径：普票税率0%、不抵扣；专票按票面税率和税额抵扣' : hospitality ? '金额口径：汇总价税合计；所有普通发票（包括3%客运服务费电子普票）抵扣为0；专票按票面税额抵扣' : '金额口径：汇总价税合计，差旅费报销单另加每天60元出差补助；普通普票抵扣为0；铁路电子客票按票面税率计算抵扣，客运服务费3%电子普票及专票按票面税额抵扣',
    ...(daily ? [`费用大类：${result.dailyBigCategory || '待补'}；费用小类按发票内容归集`] : hospitality ? [] : [`行程：${result.trip.departure || '未确定'} → ${result.trip.arrival || '未确定'}；停留 ${result.trip.days || '未确定'} 天`, '费用小类：国内差旅']),
    '费用部门、成本中心：由用户填写',
    `发票 ${result.sourceCount} 张；有效汇总 ${result.groups.length} 组；报销金额 ${money(result.totals.amountCents)}；可抵扣税额 ${money(result.totals.taxCents)}；${daily ? '表格发票票面税额' : '票面税额'} ${money(result.totals.invoiceTaxCents)}`, ''];
  lines.push('【费用事项与发票核算表】');
  const cell = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  for (const group of expenseLedger(result)) {
    lines.push(`${group.title}：${daily ? `${group.bigCategory || '大类待补'} / ${group.smallCategory || '小类待补'} / ` : ''}${group.category} / ${group.kind} / ${group.property} / ${group.rate}（${group.status}）`);
    if (group.reason) lines.push(`跳过原因：${group.reason}`);
    if (group.source === 'travelAllowance') {
      lines.push(`${group.description}；报销金额 ${money(group.amountCents)} 元；可抵扣税额 0.00 元`, '');
      continue;
    }
    lines.push('发票号码\t发票内容\t价税合计(元)\t票面税率\t票面税额(元)\t可抵扣税额(元)');
    for (const item of group.invoices) lines.push([item.number, item.content, item.amount, item.invoiceRate, item.tax, item.deductibleTax].map(cell).join('\t'));
    lines.push(`本事项合计\t${group.invoices.length} 张发票${group.attachmentAmountCents ? ' + 附件金额' : ''}\t${money(group.amountCents)}\t\t${money(group.invoiceTaxCents)}\t${money(group.taxCents)}`, `费用事项未税金额：${money(group.netCents)} 元`, '');
  }
  if (!result.groups.length) lines.push('无有效费用分组。');
  for (const category of CATEGORIES) {
    const items = result.invoices.filter(item => item.category === category);
    if (!items.length) continue;
    lines.push(`【${category}】${items.length} 张`);
    for (const group of result.groups.filter(group => group.category === category)) {
      lines.push(`  ${daily ? `${group.smallCategory || '小类待补'} / ` : ''}${group.property} / ${group.rate}：${group.invoices.length} 张${group.attachmentAmountCents ? ' + 附件金额' : ''}；报销 ${money(group.amountCents)}；可抵扣税额 ${money(group.taxCents)}；票面税额 ${money(group.invoiceTaxCents)}`);
    }
    for (const item of items) {
      lines.push(`  发票号：${item.number}`, `  发票内容：${item.content}`,
        `  对应分类：${item.category}；属性：${item.property || '待确认'}；原始票种：${item.type}；票面税率：${item.rate}；抵扣税率：${item.expenseRate}`,
        `  价税合计：${item.amount}；票面税额：${item.tax}；可抵扣税额：${money(item.deductibleTaxCents ?? 0)}；分类依据：${item.reason}`);
      if (daily) lines.push(`  费用用途：${item.bigCategory || '大类待补'} / ${item.smallCategory || '小类待补'}；依据：${item.purposeReason}`);
      if (item.issues.length) lines.push(`  待处理：${item.issues.join('；')}`);
      lines.push('');
    }
  }
  lines.push('【核对提示】', ...[...result.errors, ...result.warnings, ...result.contextIssues].map(message => `- ${message}`));
  if (!result.errors.length && !result.warnings.length && !result.contextIssues.length) lines.push('无待处理项。');
  lines.push('', '【操作记录】', ...result.events.map(event => `${new Date(event.at).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}  ${event.message}`));
  return lines.join('\n');
}
