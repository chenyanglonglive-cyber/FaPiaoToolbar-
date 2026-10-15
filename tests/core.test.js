import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate, calculateAutomatic, classify, classifyDailyPurpose, expenseLedger, extractRoute, invoiceProperty, logText, money, normalizeRate, sourceSignature, toCents} from '../extension/core.js';

const invoice = (overrides={}) => ({row:'0',number:'TEST-01',content:'汽油92号',type:'电子发票（增值税普通发票）',rate:'13.00%',amount:'113.00',tax:'13.00',net:'100.00',...overrides});
const source = invoices => ({context:'test',invoices,days:'3',descriptions:['上海到深圳']});

test('money uses integer cents and preserves exact small amounts',()=>{
  assert.equal(toCents('￥1,234.56'),123456);assert.equal(money(toCents('0.10')+toCents('0.20')),'0.30');
  assert.equal(money(toCents('-0.01')),'-0.01');
  for(const bad of ['', '1.234','NaN','1e3','Infinity'])assert.throws(()=>toCents(bad));
});
test('categories cover fuel parking tolls, lodging meals and miscellaneous',()=>{
  for(const text of ['柴油','燃油','停车费','高速公路通行费','ETC通行费','网约车','机票'])assert.equal(classify(text).category,'交通');
  assert.equal(classify('住宿服务客房费').category,'住宿');assert.equal(classify('餐饮服务餐费').category,'餐费');
  assert.equal(classify('计算机外部设备U盘').category,'其他');
});
test('mixed invoice content is flagged rather than arbitrarily assigned',()=>{
  const mixed=classify('住宿服务与餐饮服务');assert.equal(mixed.category,'其他');assert.equal(mixed.review,true);
});
test('property maps explicit ordinary and special without guessing unknown types',()=>{
  assert.equal(invoiceProperty('电子发票（增值税专用发票）').property,'专票');
  assert.equal(invoiceProperty('增值税普通发票').property,'普票');assert.equal(invoiceProperty('越南发票').property,'');
  assert.equal(invoiceProperty('电子发票（增值税普通发票）','*交通运输服务*客运服务费','3%').property,'电子打车票');
  assert.equal(invoiceProperty('电子发票（增值税普通发票）','*交通运输服务*客运服务费','6%').property,'普票');
  assert.equal(invoiceProperty('增值税普通发票','*交通运输服务*客运服务费','3%').property,'普票');
});
test('business hospitality uses ordinary zero deduction and separates meal, non-meal and special content',()=>{
  const rows = [
    invoice({row:'0', number:'MEAL', content:'*生产生活服务*餐费', rate:'1.00%', amount:'46872.70', tax:'464.09', net:'46408.61'}),
    invoice({row:'1', number:'PASSENGER-1', content:'*运输服务*客运服务费', rate:'3.00%', amount:'15.18', tax:'0.44', net:'14.74'}),
    invoice({row:'2', number:'PASSENGER-2', content:'*运输服务*客运服务费', rate:'3.00%', amount:'59.42', tax:'1.73', net:'57.69'}),
    invoice({row:'3', number:'OTHER', content:'*文具*办公用品', amount:'22986.98', tax:'2644.51', net:'20342.47'}),
    invoice({row:'4', number:'HOTEL-6A', content:'*住宿服务*住宿费', type:'电子发票（增值税专用发票）', rate:'6.00%', amount:'88.65', tax:'5.02', net:'83.63'}),
    invoice({row:'5', number:'HOTEL-6B', content:'*住宿服务*住宿费', type:'电子发票（增值税专用发票）', rate:'6.00%', amount:'169.00', tax:'9.57', net:'159.43'}),
    invoice({row:'6', number:'HOTEL-6C', content:'*住宿服务*住宿服务', type:'电子发票（增值税专用发票）', rate:'6.00%', amount:'3000.00', tax:'169.81', net:'2830.19'}),
    invoice({row:'7', number:'HOTEL-1', content:'*住宿服务*住宿费', type:'电子发票（增值税专用发票）', rate:'1.00%', amount:'391.30', tax:'3.87', net:'387.43'}),
    invoice({row:'8', number:'SERVICE-1', content:'*生产生活服务*其他生产生活服务', type:'电子发票（增值税专用发票）', rate:'1.00%', amount:'89.90', tax:'0.89', net:'89.01'}),
    invoice({row:'9', number:'GOODS-13', content:'*美容护肤品*润肤乳', type:'电子发票（增值税专用发票）', rate:'13.00%', amount:'49.90', tax:'5.74', net:'44.16'})
  ];
  const plan = calculateAutomatic({context:'hospitality-case', workflowId:'231', invoices:rows, days:'', descriptions:[], existingRoutes:[]});
  assert.equal(plan.ready,true); assert.equal(plan.contextIssues.length,0); assert.equal(plan.skippedInvoices.length,0);
  assert.equal(plan.groups.length,6); assert.equal(money(plan.totals.amountCents),'73723.03'); assert.equal(money(plan.totals.taxCents),'194.90');
  assert.equal(plan.groups.find(group=>group.key==='其他|普票|0%|通用').invoices.length,3);
  assert.equal(money(plan.groups.find(group=>group.key==='其他|普票|0%|通用').amountCents),'23061.58');
  assert.equal(money(plan.groups.find(group=>group.key==='餐费|普票|0%|通用').amountCents),'46872.70');
  assert.ok(!plan.groups.some(group=>group.source==='travelAllowance'));
  assert.match(logText(plan),/客运服务费.*15\.18.*3%.*0\.44.*0\.00/);
});
test('daily reimbursement classifies welfare or office content, pools ordinary invoices by small category, and deducts specials',()=>{
  assert.equal(classifyDailyPurpose('计算机外部设备U盘').smallCategory,'日常办公费');
  assert.equal(classifyDailyPurpose('员工福利生日蛋糕').smallCategory,'福利费');
  assert.equal(classifyDailyPurpose('鲜猪肉').smallCategory,'');
  const rows = [
    ['电池','13.00%','9.77','1.12','8.65'],['茶叶和包装','1.00%','16.20','0.17','16.03'],
    ['配送服务费','6.00%','74.61','4.23','70.38'],['配送服务费','6.00%','38.13','2.17','35.96'],
    ['配送服务费','6.00%','30.00','1.69','28.31'],['蛋糕','1.00%','58.56','0.58','57.98'],
    ['隔热垫','1.00%','89.70','0.89','88.81'],['餐饮服务','1.00%','301.50','2.99','298.51'],
    ['鲜猪肉','0.00%','163.00','0.00','163.00'],['鲜猪肉','0.00%','153.00','0.00','153.00'],
    ['鲜猪肉','0.00%','150.00','0.00','150.00']
  ].map(([content,rate,amount,tax,net],index)=>invoice({row:String(index),number:`DAILY-${index+1}`,content,rate,amount,tax,net}));
  const snapshot={context:'daily-case',workflowId:'232',dailyCategory:'薪酬福利',attachmentAmount:'1526.66',days:'',descriptions:[],existingRoutes:[],invoices:rows};
  const plan=calculateAutomatic(snapshot);
  assert.equal(plan.ready,true);assert.equal(plan.skippedInvoices.length,0);assert.equal(plan.groups.length,1);
  assert.equal(plan.groups[0].key,'其他|普票|0%|通用|福利费');assert.equal(plan.groups[0].invoices.length,11);
  assert.equal(money(plan.totals.amountCents),'2611.13');assert.equal(money(plan.totals.taxCents),'0.00');
  assert.equal(money(plan.groups[0].attachmentAmountCents),'1526.66');
  assert.match(logText(plan),/附件金额\t附件发票金额（票种未核实）\t1526\.66\t未核实\t未核实\t0\.00/);
  assert.match(plan.warnings.join(' '),/附件票种未核实/);
  assert.equal(plan.dailyBigCategory,'薪酬福利');assert.equal(plan.groups[0].smallCategory,'福利费');assert.ok(!plan.groups.some(group=>group.source==='travelAllowance'));
  const mixed=calculateAutomatic({...snapshot,invoices:[...rows,
    invoice({row:'11',number:'SPECIAL-6',content:'餐饮服务',type:'电子发票（增值税专用发票）',rate:'6%',amount:'519.00',tax:'29.38',net:'489.62'}),
    invoice({row:'12',number:'SPECIAL-13',content:'修理费',type:'电子发票（增值税专用发票）',rate:'13%',amount:'1880.01',tax:'216.28',net:'1663.73'}),
    invoice({row:'13',number:'MIXED-RATE-ORDINARY',content:'水果、洗涤用品',rate:'9.00%,13.00%,0.00%',amount:'208.98',tax:'20.33',net:'188.65'})]});
  assert.equal(mixed.groups.length,3);assert.equal(money(mixed.totals.taxCents),'245.66');
  assert.equal(mixed.skippedInvoices.length,0);assert.equal(mixed.groups.find(group=>group.key==='其他|普票|0%|通用|福利费').invoices.length,12);
  assert.equal(mixed.groups.find(group=>group.key==='其他|专票|6%|通用|福利费').invoices.length,1);
  assert.equal(mixed.groups.find(group=>group.key==='其他|专票|13%|通用|福利费').invoices.length,1);
  const attachmentOnly=calculateAutomatic({...snapshot,invoices:[]});
  assert.equal(attachmentOnly.ready,true);assert.equal(money(attachmentOnly.totals.amountCents),'1526.66');
  assert.equal(calculateAutomatic({...snapshot,attachmentAmount:'未知'}).ready,false);
  const discrepancy=calculateAutomatic({...snapshot,existing:[{values:{amount:'2612.13'}}]});
  assert.match(discrepancy.warnings.join(' '),/相差 1\.00 元/);
});
test('rates normalize percentage text while exemptions remain distinct',()=>{
  assert.equal(normalizeRate('13.00%'),'13%');assert.equal(normalizeRate('0.00%'),'0%');
  assert.equal(normalizeRate('免税'),'免税');assert.equal(normalizeRate('不征税'),'不征税');
  assert.throws(()=>normalizeRate('0.13'));assert.throws(()=>normalizeRate('101%'));
});
test('current office form pools ordinary stationery and skips a mixed-rate special until its line items are verified',()=>{
  const rows=[
    invoice({row:'0',number:'OFFICE-SPECIAL',content:'快递费,纸制品',type:'电子发票（增值税专用发票）',rate:'6.00%,13.00%',amount:'89.00',tax:'5.15',net:'83.85'}),
    invoice({row:'1',number:'BINDING',content:'装订',rate:'1%',amount:'420.00',tax:'4.16',net:'415.84'}),
    invoice({row:'2',number:'USB-1',content:'计算机外部设备U盘',rate:'1%',amount:'129.90',tax:'1.29',net:'128.61'}),
    invoice({row:'3',number:'USB-2',content:'计算机外部设备光驱',rate:'1%',amount:'93.89',tax:'0.93',net:'92.96'}),
    invoice({row:'4',number:'USB-3',content:'计算机外部设备U盘',rate:'1%',amount:'77.90',tax:'0.77',net:'77.13'})
  ];
  const plan=calculateAutomatic({context:'current-office',workflowId:'232',dailyCategory:'',attachmentAmount:'0.00',invoices:rows,
    existing:[{values:{amount:'722.69'}},{values:{amount:'87.00'}},{values:{amount:'2.00'}}]});
  assert.equal(plan.dailyBigCategory,'日常费用');
  assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].smallCategory,'日常办公费');
  assert.equal(plan.groups[0].key,'其他|普票|0%|通用|日常办公费');
  assert.equal(money(plan.groups[0].amountCents),'721.69');
  assert.deepEqual(plan.skippedInvoices.map(item=>item.number),['OFFICE-SPECIAL']);
  assert.match(plan.errors.join(' '),/多税率专票未提供可核对的逐项金额和税额/);
  assert.match(plan.warnings.join(' '),/相差 1\.00 元/);
});
test('mixed daily purposes keep clear expense groups but leave the form-wide category for manual review',()=>{
  const plan=calculateAutomatic({context:'mixed-daily',workflowId:'232',dailyCategory:'',invoices:[
    invoice({row:'0',number:'OFFICE',content:'办公用品装订',amount:'100.00',tax:'0.00',net:'100.00',rate:'0%'}),
    invoice({row:'1',number:'WELFARE',content:'员工福利生日蛋糕',amount:'50.00',tax:'0.00',net:'50.00',rate:'0%'})]});
  assert.equal(plan.ready,true);assert.equal(plan.dailyBigCategory,'');assert.equal(plan.groups.length,2);
  assert.deepEqual(plan.groups.map(group=>group.smallCategory).sort(),['日常办公费','福利费'].sort());
  assert.match(plan.warnings.join(' '),/费用大类是整单字段/);
  const skipped=calculateAutomatic({context:'mixed-with-skip',workflowId:'232',dailyCategory:'',invoices:[
    invoice({row:'0',number:'OFFICE-SPECIAL',content:'快递费,纸制品',type:'增值税专用发票',rate:'6%,13%',amount:'89.00',tax:'5.15',net:'83.85'}),
    invoice({row:'1',number:'WELFARE',content:'员工福利生日蛋糕',amount:'50.00',tax:'0.00',net:'50.00',rate:'0%'})]});
  assert.equal(skipped.dailyBigCategory,'');assert.equal(skipped.skippedInvoices.length,1);
});
test('travel uses prescribed description and does not invent ambiguous routes',()=>{
  assert.deepEqual(extractRoute(['上海到深圳']).departure,'上海');assert.equal(extractRoute(['上海到深圳']).arrival,'深圳');
  assert.equal(extractRoute(['出差：上海到深圳；客户拜访']).arrival,'深圳');
  assert.equal(extractRoute(['上海到深圳','北京到深圳']).departure,'');
  assert.equal(extractRoute(['上海电气投标保证金']).departure,'');
});
test('grouping uses deductible rate and includes unchecked invoices',()=>{
  const plan=calculate(source([
    invoice({selected:false}),invoice({row:'2',number:'TEST-02',selected:true}),
    invoice({row:'4',number:'TEST-03',type:'增值税专用发票'}),
    invoice({row:'7',number:'TEST-04',rate:'0%',amount:'50.00',tax:'0.00',net:'50.00'})
  ]));
  assert.equal(plan.groups.length,2);assert.equal(plan.sourceCount,4);assert.equal(plan.totals.amountCents,38900);assert.equal(plan.totals.taxCents,1300);
  assert.equal(plan.groups.find(group=>group.key==='交通|普票|0%|燃油').invoices.length,3);assert.equal(plan.ready,true);
});
test('ordinary invoice face tax is retained for audit but not deducted',()=>{
  const plan=calculate(source([invoice({amount:'391.00',tax:'44.98',net:'346.02'}),invoice({row:'2',number:'TEST-02',amount:'375.00',tax:'43.14',net:'331.86'})]));
  assert.equal(money(plan.totals.amountCents),'766.00');assert.equal(money(plan.totals.taxCents),'0.00');assert.equal(money(plan.totals.invoiceTaxCents),'88.12');
});
test('duplicate invoice numbers stop filling rather than silently deduplicating',()=>{
  const plan=calculate(source([invoice(),invoice({row:'3'})]));assert.equal(plan.ready,false);assert.match(plan.errors.join(' '),/重复/);
});
test('missing tax and inconsistent totals block filling',()=>{
  assert.equal(calculate(source([invoice({tax:''})])).ready,false);
  assert.equal(calculate(source([invoice({net:'90.00'})])).ready,false);
});
test('red ordinary invoices retain negative gross and face tax but zero deductible tax',()=>{
  const plan=calculate(source([invoice({amount:'-113.00',tax:'-13.00',net:'-100.00'})]));
  assert.equal(plan.ready,true);assert.equal(plan.totals.amountCents,-11300);assert.equal(plan.totals.taxCents,0);assert.equal(plan.totals.invoiceTaxCents,-1300);
});
test('unknown properties require user confirmation',()=>{
  const snapshot=source([invoice({type:'未识别票种'})]);assert.equal(calculate(snapshot).ready,false);
  assert.equal(calculate(snapshot,{'0':{property:'普票'}}).ready,true);
});
test('manual category changes are recorded and regrouped',()=>{
  const plan=calculate(source([invoice()]),{'0':{category:'其他'}});assert.equal(plan.groups[0].category,'其他');assert.equal(plan.invoices[0].reason,'人工调整分类');
});
test('empty source, invalid days and missing route stop filling',()=>{
  assert.equal(calculate(source([])).ready,false);
  assert.equal(calculate({...source([invoice()]),days:'0'}).ready,false);
  assert.equal(calculate({...source([invoice()]),descriptions:['保证金']}).ready,false);
});
test('route is shared by all groups and never expands groups',()=>{
  const snapshot=source([invoice(),invoice({row:'2',number:'TEST-02'})]);snapshot.descriptions=['上海到深圳','北京到深圳'];
  const plan=calculate(snapshot,{}, {departure:'上海',arrival:'深圳',days:'3'});assert.equal(plan.groups.length,1);assert.equal(plan.ready,true);
});
test('fingerprint changes on data edits but ignores deletion checkbox changes',()=>{
  const snapshot=source([invoice()]);const original=sourceSignature(snapshot);snapshot.invoices[0].selected=true;assert.equal(sourceSignature(snapshot),original);
  snapshot.invoices[0].amount='100.00';assert.notEqual(sourceSignature(snapshot),original);
  const withAttachment={...snapshot,attachmentAmount:'1526.66'};const signature=sourceSignature(withAttachment);
  withAttachment.attachmentAmount='1526.67';assert.notEqual(sourceSignature(withAttachment),signature);
});
test('logs include each invoice number, content, category, grouping and amount basis',()=>{
  const plan=calculate(source([invoice()]));const text=logText(plan);
  for(const expected of ['TEST-01','汽油92号','对应分类：交通','普票 / 0%','票面税额','可抵扣税额','北京时间','【操作记录】'])assert.ok(text.includes(expected),expected);
});

test('核算表逐事项关联发票并保留逐票和汇总金额',()=>{
  const plan=calculate(source([invoice(),invoice({row:'2',number:'TEST-02'}),invoice({row:'4',number:'TEST-03',type:'增值税专用发票'})]));
  plan.writeOutcome={writtenGroups:[{key:'交通|普票|0%|燃油',position:2},{key:'交通|专票|13%|燃油',position:3}],skippedGroups:[]};
  const ledger=expenseLedger(plan);
  assert.equal(ledger.length,2);assert.equal(ledger[0].title,'费用事项第 2 行');assert.equal(ledger[0].status,'已填入');
  assert.deepEqual(ledger[0].invoices.map(item=>item.number),['TEST-01','TEST-02']);assert.equal(ledger[0].amountCents,22600);assert.equal(ledger[0].taxCents,0);
  const text=logText(plan);assert.ok(text.includes('【费用事项与发票核算表】'));assert.ok(text.includes('本事项合计\t2 张发票\t226.00\t\t26.00\t0.00'));assert.ok(text.includes('TEST-03\t汽油92号\t113.00\t13%\t13.00\t13.00'));
});
test('reference grouping yields four expense rows and keeps ordinary tax non-deductible',()=>{
  const rows = [
    ['客运服务费','3%','39.25','1.14'],['客运服务费','3%','24.10','0.70'],
    ['汽油92号车用汽油','13%','391.00','44.98'],['汽油92号车用汽油','13%','375.00','43.14'],['汽油92号车用汽油','13%','388.00','44.64'],
    ['代收转付境内机票费*代订机票产品','0%','620.00','0.00'],['生产生活服务*代订机票产品','6%','517.00','29.26'],
    ['计算机外部设备U盘','1%','129.90','1.29'],['计算机外部设备U盘','1%','93.89','0.93'],['计算机外部设备U盘','1%','77.90','0.77']
  ].map(([content,rate,amount,tax],index)=>({row:String(index),number:`REF-${index+1}`,content,type:'电子发票（增值税普通发票）',rate,amount,tax}));
  const plan=calculate(source(rows));
  assert.equal(plan.groups.length,4);
  assert.deepEqual(plan.groups.map(group=>[group.key,money(group.amountCents)]),[
    ['交通|电子打车票|3%|打车','63.35'],['交通|普票|0%|燃油','1154.00'],
    ['交通|机票|0%|机票','1137.00'],['其他|普票|0%|通用','301.69']
  ]);
  assert.equal(money(plan.totals.amountCents),'2656.04');
  assert.equal(plan.groups[0].taxCents,184);assert.equal(plan.groups.slice(1).every(group=>group.taxCents===0),true);
});
test('current travel form groups 16 invoices into 10 expense items including 11-day allowance and rail tax',()=>{
  const rows = [
    ['租车费','增值税专用发票','1%','306.00','3.03'],
    ['出行服务费','增值税专用发票','6%','424.56','24.03'],
    ['租车费','增值税普通发票','3%','693.08','20.19'],
    ['出行服务费','增值税普通发票','3%','900.13','26.22'],
    ['铁路电子客票','铁路电子客票','9%','381.00','31.46'],
    ['铁路电子客票','铁路电子客票','9%','59.50','4.91'],
    ['铁路电子客票','铁路电子客票','9%','685.00','56.56'],
    ['餐饮服务餐费','增值税普通发票','0%','623.00','0.00'],
    ['餐饮服务餐费','增值税普通发票','0%','623.00','0.00'],
    ['代驾服务费','增值税普通发票','3%','156.50','4.56'],
    ['客运服务费','电子发票（增值税普通发票）','3%','146.00','4.25'],
    ['客运服务费','电子发票（增值税普通发票）','3%','146.00','4.25'],
    ['客运服务费','电子发票（增值税普通发票）','3%','146.00','4.25'],
    ['航空旅客人身意外伤害保险','增值税普通发票','0%','50.00','0.00'],
    ['机票款','增值税普通发票','0%','980.00','0.00'],
    ['住宿服务','增值税专用发票','6%','2431.00','137.60']
  ].map(([content,type,rate,amount,tax],index)=>({row:String(index),number:`FORM-${index+1}`,content,type,rate,amount,tax,net:money(toCents(amount)-toCents(tax))}));
  const snapshot={context:'completed-travel-form',workflowId:'230',days:'11',descriptions:['广西来宾路改协调'],
    existingRoutes:[{departure:'中国/广东/深圳',arrival:'中国/广西/来宾'}],invoices:rows};
  const plan=calculateAutomatic(snapshot);
  assert.equal(plan.ready,true);assert.equal(plan.groups.length,10);assert.equal(plan.sourceCount,16);
  assert.equal(money(plan.totals.amountCents),'9410.77');assert.equal(money(plan.totals.taxCents),'270.34');
  assert.equal(plan.trip.departure,'中国/广东/深圳');assert.equal(plan.trip.arrival,'中国/广西/来宾');
  const group=key=>plan.groups.find(item=>item.key===key);
  assert.equal(money(group('交通|火车票|9%-计算抵扣|火车').amountCents),'1125.50');
  assert.equal(money(group('交通|火车票|9%-计算抵扣|火车').taxCents),'92.93');
  assert.equal(money(group('交通|机票|0%|机票').amountCents),'1030.00');
  assert.equal(money(group('交通|普票|0%|租车代驾').amountCents),'849.58');
  assert.equal(money(group('其他|其他|0%|出差补助').amountCents),'660.00');
  assert.equal(group('其他|其他|0%|出差补助').invoices.length,0);
  assert.match(logText(plan),/出差补助：11 天 × 60 元\/天/);
  assert.equal(calculateAutomatic({...snapshot,workflowId:'999'}).groups.length,9);
  assert.equal(calculateAutomatic({...snapshot,invoices:[]}).groups.length,0);
});
test('跳过分组在核算表明确标记为未填入，不虚构原表行号',()=>{
  const plan=calculate(source([invoice()]));
  assert.equal(expenseLedger(plan)[0].status,'未确认填写');
  plan.writeOutcome={writtenGroups:[],skippedGroups:[{key:plan.groups[0].key,reason:'系统不支持13%'}]};
  const group=expenseLedger(plan)[0];assert.equal(group.status,'已跳过，未填入');assert.equal(group.title,'费用分组 1');assert.equal(group.reason,'系统不支持13%');assert.match(logText(plan),/已跳过，未填入/);
});
