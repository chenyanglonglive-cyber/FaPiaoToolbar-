import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate, classify, expenseLedger, extractRoute, invoiceProperty, logText, money, normalizeRate, sourceSignature, toCents} from '../extension/core.js';

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
test('rates normalize percentage text while exemptions remain distinct',()=>{
  assert.equal(normalizeRate('13.00%'),'13%');assert.equal(normalizeRate('0.00%'),'0%');
  assert.equal(normalizeRate('免税'),'免税');assert.equal(normalizeRate('不征税'),'不征税');
  assert.throws(()=>normalizeRate('0.13'));assert.throws(()=>normalizeRate('101%'));
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
    ['交通|普票|0%|机票','1137.00'],['其他|普票|0%|通用','301.69']
  ]);
  assert.equal(money(plan.totals.amountCents),'2656.04');
  assert.equal(plan.groups[0].taxCents,184);assert.equal(plan.groups.slice(1).every(group=>group.taxCents===0),true);
});
test('跳过分组在核算表明确标记为未填入，不虚构原表行号',()=>{
  const plan=calculate(source([invoice()]));
  assert.equal(expenseLedger(plan)[0].status,'未确认填写');
  plan.writeOutcome={writtenGroups:[],skippedGroups:[{key:plan.groups[0].key,reason:'系统不支持13%'}]};
  const group=expenseLedger(plan)[0];assert.equal(group.status,'已跳过，未填入');assert.equal(group.title,'费用分组 1');assert.equal(group.reason,'系统不支持13%');assert.match(logText(plan),/已跳过，未填入/);
});
