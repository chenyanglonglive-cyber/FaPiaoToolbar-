import {calculate,calculateAutomatic,sourceSignature} from '../extension/core.js';
const frame=document.getElementById('form');
const results=document.getElementById('results');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const load=async()=>{await new Promise(resolve=>{frame.onload=resolve;frame.src=`../extension/demo/form.html?reset=${Date.now()}`;});return frame.contentWindow;};
async function suite(){
  document.getElementById('run').disabled=true;results.replaceChildren();let passed=0;let failed=0;
  const filter=new URLSearchParams(location.search).get('filter');
  const run=async(name,fn)=>{if(filter&&!name.includes(filter))return;const li=document.createElement('li');results.append(li);try{await fn();li.className='pass';li.textContent=`通过：${name}`;passed++;}catch(error){li.className='fail';li.textContent=`失败：${name} — ${error.message}`;failed++;}};
  await run('读取全部发票，忽略删除勾选，并保留不连续行号',async()=>{
    const w=await load();const r=await w.JdlExpenseAdapter.run('read');assert(r.ok,r.error);assert(r.snapshot.invoices.length===9,'未读取全部9张');assert(r.snapshot.invoices[1].row==='2','行号被错误重排');assert(w.MockForm.apiCalls().length===0,'读取修改了表单');
    assert(sourceSignature(r.snapshot)===calculate(r.snapshot).signature,'指纹口径不一致');
  });
  await run('真实系统固定表头副本排在数据表前时仍读取全部发票',async()=>{
    const w=await load();const before=await w.JdlExpenseAdapter.run('read');
    for(const id of ['oTable2','oTable6','oTable0']) {
      const table=w.document.getElementById(id);const head=table.cloneNode(true);head.id=id+'_head';head.querySelector('tbody').replaceChildren();table.before(head);
    }
    const reply=await w.JdlExpenseAdapter.run('read');assert(reply.ok,reply.error);assert(sourceSignature(before.snapshot)===sourceSignature(reply.snapshot),'误选固定表头副本');assert(w.MockForm.apiCalls().length===0,'读取修改了表单');
    const filled=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(reply.snapshot));assert(filled.ok,filled.error);assert(filled.rows.length===8,'固定表头影响费用生成');
  });
  await run('只读字段仅有span ID且没有行标记时读取全部发票',async()=>{
    const w=await load();const before=await w.JdlExpenseAdapter.run('read');
    w.document.querySelectorAll('#oTable2 tr[data-rowindex], #oTable6 tr[data-rowindex]').forEach(row=>{
      row.removeAttribute('data-rowindex');row.querySelectorAll('[data-fieldmark]').forEach(root=>{root.id=root.dataset.fieldmark+'span';root.removeAttribute('data-fieldmark');});
    });
    const reply=await w.JdlExpenseAdapter.run('read');assert(reply.ok,reply.error);
    assert(sourceSignature(before.snapshot)===sourceSignature(reply.snapshot),'只读字段数据发生变化');assert(w.MockForm.apiCalls().length===0,'读取修改了表单');
  });
  await run('全部发票为纯文本时按完整序号匹配不连续系统行号并排除合计',async()=>{
    const w=await load();const before=await w.JdlExpenseAdapter.run('read');
    const table=w.document.getElementById('oTable2');table.querySelectorAll('tr[data-rowindex]').forEach(row=>{row.removeAttribute('data-rowindex');row.querySelectorAll('[data-fieldmark]').forEach(root=>root.removeAttribute('data-fieldmark'));});
    const total=table.insertRow();total.insertCell().textContent='合计/TOTAL';
    const reply=await w.JdlExpenseAdapter.run('read');assert(reply.ok,reply.error);assert(sourceSignature(before.snapshot)===sourceSignature(reply.snapshot),'纯文本发票未完整读取');assert(w.MockForm.apiCalls().length===0,'读取修改了表单');
  });
  await run('纯文本发票只挂载部分行时拒绝猜测行号',async()=>{
    const w=await load();const table=w.document.getElementById('oTable2');table.querySelectorAll('tr[data-rowindex]').forEach((row,index)=>{if(index===0){row.remove();return;}row.removeAttribute('data-rowindex');row.querySelectorAll('[data-fieldmark]').forEach(root=>root.removeAttribute('data-fieldmark'));});
    const reply=await w.JdlExpenseAdapter.run('read');assert(!reply.ok,'不完整表格未阻止');assert(w.MockForm.apiCalls().length===0,'失败读取修改了表单');
  });
  await run('明细行与字段ID冲突时拒绝错配发票',async()=>{
    const w=await load();w.document.querySelector('#oTable2 tr[data-rowindex="0"]').dataset.rowindex='2';
    const reply=await w.JdlExpenseAdapter.run('read');assert(!reply.ok&&reply.error.includes('不一致'),'冲突行未阻止');assert(w.MockForm.apiCalls().length===0,'冲突读取修改了表单');
  });
  await run('按真实选项代码填入四类费用，保留空白部门和成本中心',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');const plan=calculate(read.snapshot);const reply=await w.JdlExpenseAdapter.run('apply',plan);assert(reply.ok,reply.error);
    assert(reply.rows.length===7,'分组数量不正确');assert(w.WfForm.getFieldValue('field21320_0')==='exp-travel','使用了猜测的选项顺序');assert(w.WfForm.getFieldValue('field21313_0')==='city-sh','城市代码不正确');
    assert(reply.rows.every(row=>!w.WfForm.getFieldValue(`field21326_${row}`)&&!w.WfForm.getFieldValue(`field21325_${row}`)),'修改了部门或成本中心');
    assert(w.WfForm.getFieldValue('field21319_0')==='766.00','交通合计不正确');assert(w.WfForm.getFieldValue('field21324_0')==='0.00','普票不应抵扣票面税额');
  });
  await run('重复填写更新自己的行，不重复新增；保留手填部门',async()=>{
    const w=await load();let read=await w.JdlExpenseAdapter.run('read');let reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);
    w.WfForm.changeFieldValue('field21326_0',{value:'manual-dept'});read=await w.JdlExpenseAdapter.run('read');reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);
    assert(w.MockForm.rows.detail_1.length===7,'重复新增');assert(w.WfForm.getFieldValue('field21326_0')==='manual-dept','丢失手填部门');
  });
  await run('预览后来源发票变化，填写前阻止旧结果',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');const plan=calculate(read.snapshot);w.MockForm.setSource('0','发票价税合计','392.00');const reply=await w.JdlExpenseAdapter.run('apply',plan);
    assert(!reply.ok&&reply.error.includes('已变化'),'没有阻止旧数据');assert(w.MockForm.apiCalls().length===0,'阻止前已修改表单');
  });
  await run('已有人工事项时阻止覆盖与重复汇总',async()=>{
    const w=await load();w.WfForm.changeFieldValue('field21319_0',{value:'123.00'});const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(!reply.ok&&reply.error.includes('人工填写'),'未保护人工内容');assert(w.WfForm.getFieldValue('field21319_0')==='123.00','人工金额被改变');
  });
  await run('插件生成的金额被手改后停止自动更新',async()=>{
    const w=await load();let read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot))).ok,'首次填写失败');w.WfForm.changeFieldValue('field21319_0',{value:'777.00'});
    read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(!reply.ok&&reply.error.includes('已修改'),'手改字段被覆盖');assert(w.WfForm.getFieldValue('field21319_0')==='777.00','手改金额丢失');
  });
  await run('撤销恢复原空行，并删除仅由插件新增的行',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot))).ok,'填写失败');const reply=await w.JdlExpenseAdapter.run('undo');assert(reply.ok,reply.error);assert(w.MockForm.rows.detail_1.length===1,'撤销后新增行仍在');assert(w.WfForm.getFieldValue('field21319_0')==='','没有恢复原金额');
  });
  await run('新增行补过部门后，不自动删除用户内容',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');const applied=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(applied.ok,applied.error);w.WfForm.changeFieldValue('field21326_1',{value:'dept'});const reply=await w.JdlExpenseAdapter.run('undo');assert(!reply.ok&&reply.error.includes('手填'),'未保护手填部门');assert(w.MockForm.rows.detail_1.length===7,'错误地部分撤销了原表');
  });
  await run('填写中途失败，回退之前已写入的字段和新增行',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');w.MockForm.failAt('field21324_1');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(!reply.ok, '预期失败未发生');assert(w.MockForm.rows.detail_1.length===1,'未回退新增行');assert(w.WfForm.getFieldValue('field21319_0')==='','原空行金额未恢复');
  });
  await run('切换报销单后，不能撤销上一个报销单',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot))).ok,'填写失败');w.MockForm.setContext('another-request');const reply=await w.JdlExpenseAdapter.run('undo');assert(!reply.ok,'跨报销单撤销');
  });
  await run('分组金额被改变后，填写前核对票面金额并阻止',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');const plan=calculate(read.snapshot);plan.groups[0].amountCents+=100;
    const reply=await w.JdlExpenseAdapter.run('apply',plan);assert(!reply.ok&&reply.error.includes('报销金额'),'金额篡改未被阻止');assert(w.MockForm.apiCalls().length===0,'核对前修改了表单');
  });
  await run('移除发票后重新计算，移除过期的插件分组；撤销可恢复上次内容',async()=>{
    const w=await load();let read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot))).ok,'首次填写失败');
    w.MockForm.removeSource('16');read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);assert(w.MockForm.rows.detail_1.length===6,'旧其他分组没有移除');
    const undo=await w.JdlExpenseAdapter.run('undo');assert(undo.ok,undo.error);assert(w.MockForm.rows.detail_1.length===7,'未恢复上一次填写的旧组');
  });
  await run('重复填写后的撤销保留手填部门',async()=>{
    const w=await load();let read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot))).ok,'首次填写失败');w.WfForm.changeFieldValue('field21326_0',{value:'manual-dept'});
    read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot))).ok,'再次填写失败');const reply=await w.JdlExpenseAdapter.run('undo');assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21326_0')==='manual-dept','撤销丢失手填部门');
  });
  await run('首次已选好城市和国内差旅的空事项可以作为模板，撤销保留预选项',async()=>{
    const w=await load();w.WfForm.changeFieldValue('field21331_0',{value:'travel-domestic'});w.WfForm.changeFieldValue('field21313_0',{value:'city-sh'});w.WfForm.changeFieldValue('field21314_0',{value:'city-sz'});
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);const undo=await w.JdlExpenseAdapter.run('undo');assert(undo.ok,undo.error);assert(w.WfForm.getFieldValue('field21331_0')==='travel-domestic','预选小类被清除');assert(w.WfForm.getFieldValue('field21313_0')==='city-sh','预选城市被清除');
  });
  await run('React下拉选项从实际属性读取值，不依赖顺序',async()=>{
    const w=await load();
    for(const field of ['field21320_0','field21323_0']){
      const root=w.document.querySelector(`[data-fieldmark="${field}"]`);const input=root.querySelector('select');const options=Array.from(input.options).map(option=>({value:option.value,label:option.textContent}));
      input.remove();const hidden=w.document.createElement('input');hidden.type='hidden';hidden.id=field;const label=w.document.createElement('span');label.className='ant-select-selection-selected-value';root.append(hidden,label);root.__reactProps$fixture={options};
    }
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21320_0')==='exp-travel','React分类值不正确');assert(w.WfForm.getFieldValue('field21323_0')==='rate-0','React税率值不正确');
  });
  await run('真实结构费用小类弹窗支持“国内差旅费”，并自动关闭选择窗口',async()=>{
    const w=await load();for(const row of [...w.MockForm.rows.detail_3].slice(1))w.MockForm.removeSource(row);
    const root=w.document.querySelector('[data-fieldmark="field21331_0"]');root.replaceChildren();const hidden=w.document.createElement('input');hidden.type='hidden';hidden.id='field21331_0';const selected=w.document.createElement('span');selected.className='ant-select-selection-selected-value';const button=w.document.createElement('button');button.textContent='选择';root.append(hidden,selected,button);
    button.onclick=()=>{const dialog=w.document.createElement('div');dialog.setAttribute('role','dialog');const table=w.document.createElement('table');const row=table.insertRow();const cell=row.insertCell();cell.textContent='国内差旅费';cell.onclick=()=>{w.WfForm.changeFieldValue('field21331_0',{value:'travel-domestic'});selected.textContent='国内差旅费';selected.title='国内差旅费';dialog.remove();};dialog.append(table);w.document.body.append(dialog);};
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21331_0')==='travel-domestic','未选择国内差旅费');assert(!w.document.querySelector('[role=dialog]'),'窗口没有关闭');
  });
  await run('城市联想完整路径只匹配中国城市，不误选相似海外城市',async()=>{
    const w=await load();for(const row of [...w.MockForm.rows.detail_3].slice(1))w.MockForm.removeSource(row);
    for(const [field,code,path] of [['field21313_0','city-sh','中国/上海/上海'],['field21314_0','city-sz','中国/广东/深圳']]){
      const root=w.document.querySelector(`[data-fieldmark="${field}"]`);root.replaceChildren();const hidden=w.document.createElement('input');hidden.type='hidden';hidden.id=field;const combo=w.document.createElement('div');combo.setAttribute('role','combobox');const input=w.document.createElement('input');input.className='ant-select-search__field';const selected=w.document.createElement('span');selected.className='ant-select-selection-selected-value';combo.append(input,selected);root.append(hidden,combo);
      input.oninput=()=>{w.document.querySelector('.test-dropdown')?.remove();const list=w.document.createElement('ul');list.className='test-dropdown';for(const label of [path,'芬兰/考哈瓦/上海尔迈']){const option=w.document.createElement('li');option.className='ant-select-dropdown-menu-item';option.textContent=label;option.onclick=()=>{w.WfForm.changeFieldValue(field,{value:label===path?code:'wrong-city'});selected.textContent=label;selected.title=label;list.remove();};list.append(option);}w.document.body.append(list);};
    }
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21313_0')==='city-sh','误选上海');assert(w.WfForm.getFieldValue('field21314_0')==='city-sz','未选深圳');
  });
  await run('系统普票只允许0%时按抵扣税率填写',async()=>{
    const w=await load();for(const row of [...w.MockForm.rows.detail_3].slice(1))w.MockForm.removeSource(row);
    const select=w.document.getElementById('field21323_0');select.replaceChildren(new w.Option('',''),new w.Option('0%','rate-0'));
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('apply',calculate(read.snapshot));assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21319_0')==='391.00','普票报销金额未填');assert(w.WfForm.getFieldValue('field21323_0')==='rate-0','普票抵扣率应为0%');assert(w.WfForm.getFieldValue('field21324_0')==='0.00','普票抵扣税额应为0');
  });
  await run('客运服务费3%电子普票填电子打车票并抵扣票面税额',async()=>{
    const w=await load();for(const row of [...w.MockForm.rows.detail_3].slice(1))w.MockForm.removeSource(row);
    for(const [label,value] of [['发票内容','*交通运输服务*客运服务费'],['发票税率','3%'],['发票价税合计','39.25'],['发票未税金额','38.11'],['发票税额','1.14']])w.MockForm.setSource('0',label,value);
    const read=await w.JdlExpenseAdapter.run('read');const plan=calculateAutomatic(read.snapshot);
    assert(plan.groups.length===2&&plan.groups[0].key==='交通|电子打车票|3%|打车'&&plan.groups[1].key==='其他|其他|0%|出差补助','打车票或补助分组错误');
    const reply=await w.JdlExpenseAdapter.run('automatic',plan);assert(reply.ok,reply.error);
    assert(w.WfForm.getFieldValue('field21332_0')==='taxi-code','未选电子打车票');
    assert(w.WfForm.getFieldValue('field21323_0')==='rate-3','未选票面3%');
    assert(w.WfForm.getFieldValue('field21319_0')==='39.25'&&w.WfForm.getFieldValue('field21324_0')==='1.14','金额或可抵扣税额错误');
  });
  await run('铁路电子客票按票面9%计算抵扣并另加每日60元补助，重复运行不增加事项',async()=>{
    const w=await load();for(const row of [...w.MockForm.rows.detail_3].slice(1))w.MockForm.removeSource(row);
    for(const [label,value] of [['发票内容','铁路电子客票'],['发票类型','铁路电子客票'],['发票税率','9%'],['发票价税合计','381.00'],['发票未税金额','349.54'],['发票税额','31.46']])w.MockForm.setSource('0',label,value);
    let read=await w.JdlExpenseAdapter.run('read');let plan=calculateAutomatic(read.snapshot);
    assert(plan.groups.length===2&&plan.groups[0].key==='交通|火车票|9%-计算抵扣|火车','火车票分类或税率错误');
    let reply=await w.JdlExpenseAdapter.run('automatic',plan);assert(reply.ok,reply.error);
    assert(reply.rows.length===2,'补助事项未写入');
    assert(w.WfForm.getFieldValue('field21332_0')==='train-code'&&w.WfForm.getFieldValue('field21323_0')==='rate-9-deduct','系统火车票选项未匹配');
    assert(w.WfForm.getFieldValue('field21319_0')==='381.00'&&w.WfForm.getFieldValue('field21324_0')==='31.46','火车票金额或税额错误');
    assert(w.WfForm.getFieldValue('field21332_1')==='other-code'&&w.WfForm.getFieldValue('field21319_1')==='180.00'&&w.WfForm.getFieldValue('field21324_1')==='0.00','3天补助未写入');
    read=await w.JdlExpenseAdapter.run('read');plan=calculateAutomatic(read.snapshot);reply=await w.JdlExpenseAdapter.run('automatic',plan);
    assert(reply.ok,reply.error);assert(w.MockForm.rows.detail_1.length===2,'重复运行产生额外补助行');
  });
  await run('自动模式缺少城市和天数时仍填写金额，字段留空并提示',async()=>{
    const w=await load();w.MockForm.values.set('field40000_0','行程未确定');w.MockForm.values.set('field21403','');
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(reply.ok,reply.error);
    assert(reply.rows.length===7,'缺城市阻断金额');assert(w.WfForm.getFieldValue('field21319_0')==='766.00','金额未填');assert(!w.WfForm.getFieldValue('field21313_0'),'猜测城市');assert(reply.pending.some(item=>item.includes('出发城市'))&&reply.pending.some(item=>item.includes('停留天数')),'缺失提示不完整');
  });
  await run('自动模式覆盖人工金额并按分组保留部门成本中心，重复运行不增加行',async()=>{
    const w=await load();for(const [field,value] of [['field21320','exp-travel'],['field21332','ordinary-code'],['field21323','rate-0'],['field21319','766.00'],['field21326','manual-dept'],['field21325','manual-cost']])w.WfForm.changeFieldValue(`${field}_0`,{value});
    let read=await w.JdlExpenseAdapter.run('read');let reply=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21319_0')==='766.00','未覆盖');assert(w.WfForm.getFieldValue('field21326_0')==='manual-dept'&&w.WfForm.getFieldValue('field21325_0')==='manual-cost','未保留匹配部门');
    read=await w.JdlExpenseAdapter.run('read');reply=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(reply.ok,reply.error);assert(w.MockForm.rows.detail_1.length===8,'重复运行增加行');
  });
  await run('自动模式跳过无效和重复发票，不漏掉有效发票',async()=>{
    const w=await load();w.MockForm.setSource('0','发票号码','DUPLICATE');w.MockForm.setSource('2','发票号码','DUPLICATE');w.MockForm.setSource('4','发票税额','');
    const read=await w.JdlExpenseAdapter.run('read');const plan=calculateAutomatic(read.snapshot);assert(plan.skippedInvoices.length===3,'未跳过全部重复或无效票');const reply=await w.JdlExpenseAdapter.run('automatic',plan);assert(reply.ok,reply.error);assert(reply.rows.length===7,'有效票分组不正确');
  });
  await run('自动模式将普票统一归为0%并清空无法匹配的旧行',async()=>{
    const w=await load();for(const row of [...w.MockForm.rows.detail_3].slice(2))w.MockForm.removeSource(row);w.MockForm.setSource('2','发票税率','0%');w.MockForm.setSource('2','发票税额','0.00');w.MockForm.setSource('2','发票未税金额','375.00');
    for(const [field,value] of [['field21320','exp-travel'],['field21332','ordinary-code'],['field21323','rate-13'],['field21319','999.00'],['field21326','manual-dept']])w.WfForm.changeFieldValue(`${field}_0`,{value});
    w.MockForm.setOrdinaryRatesZero();
    const read=await w.JdlExpenseAdapter.run('read');const reply=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(reply.ok,reply.error);assert(reply.rows.length===2&&reply.skippedGroups.length===0,'普票0%或补助未填写');assert(w.WfForm.getFieldValue('field21319_0')==='','保留了旧报销金额');assert(w.WfForm.getFieldValue('field21326_0')==='manual-dept','丢失部门');
  });
  await run('自动模式无法匹配旧分组保留部门并清空旧金额，全部发票无效时不覆盖',async()=>{
    const w=await load();w.WfForm.changeFieldValue('field21319_0',{value:'999.00'});w.WfForm.changeFieldValue('field21326_0',{value:'unmatched-dept'});
    let read=await w.JdlExpenseAdapter.run('read');let reply=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(reply.ok,reply.error);assert(w.WfForm.getFieldValue('field21319_0')==='','未清理旧金额');assert(w.WfForm.getFieldValue('field21326_0')==='unmatched-dept'&&reply.pending.some(item=>item.includes('无法匹配')),'无法匹配信息丢失');
    for(const row of [...w.MockForm.rows.detail_3])w.MockForm.setSource(row,'发票税额','');const count=w.MockForm.apiCalls().length;read=await w.JdlExpenseAdapter.run('read');reply=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(!reply.ok,'全无效不应覆盖');assert(count===w.MockForm.apiCalls().length,'全无效改变原表');
  });
  await run('公共字段候选取自当前页面并批量填写所有费用事项',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');
    const created=await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot));assert(created.ok,created.error);
    const options=await w.JdlExpenseAdapter.run('sharedOptions');assert(options.ok,options.error);
    assert(options.rowCount===8,'未识别当前8条费用事项');
    assert(options.options.department.includes('明阳智慧综合部')&&options.options.costCenter.includes('深圳佳利达')&&options.options.departure.includes('深圳'),'未从页面读取动态选项');
    const before=w.MockForm.rows.detail_1.map(row=>w.WfForm.getFieldValue(`field21319_${row}`));
    const applied=await w.JdlExpenseAdapter.run('applyShared',{context:options.context,fingerprint:options.fingerprint,
      values:{department:'明阳智慧综合部',costCenter:'深圳佳利达',departure:'深圳',arrival:'北京'}});
    assert(applied.ok,applied.error);assert(applied.written.length===32,'公共字段未逐项填写');assert(applied.pending.length===0&&applied.missing.length===0,'完成后仍显示缺失');
    for(const [index,row] of w.MockForm.rows.detail_1.entries()){
      assert(w.WfForm.getFieldValue(`field21326_${row}`)==='dept-admin','部门未填写');
      assert(w.WfForm.getFieldValue(`field21325_${row}`)==='cost-shenzhen','成本中心未填写');
      assert(w.WfForm.getFieldValue(`field21313_${row}`)==='city-sz'&&w.WfForm.getFieldValue(`field21314_${row}`)==='city-bj','城市未填写');
      assert(w.WfForm.getFieldValue(`field21319_${row}`)===before[index],'批量填写改变了报销金额');
    }
  });
  await run('公共字段填写校验报销单和事项状态，未知选项单独提示',async()=>{
    const w=await load();const read=await w.JdlExpenseAdapter.run('read');assert((await w.JdlExpenseAdapter.run('automatic',calculateAutomatic(read.snapshot))).ok,'事项创建失败');
    let options=await w.JdlExpenseAdapter.run('sharedOptions');const count=w.MockForm.apiCalls().length;
    w.MockForm.setContext('other-request');let reply=await w.JdlExpenseAdapter.run('applyShared',{context:options.context,fingerprint:options.fingerprint,values:{department:'明阳智慧综合部'}});
    assert(!reply.ok&&w.MockForm.apiCalls().length===count,'切换报销单后仍写入');
    options=await w.JdlExpenseAdapter.run('sharedOptions');
    reply=await w.JdlExpenseAdapter.run('applyShared',{context:options.context,fingerprint:options.fingerprint,values:{department:'明阳智慧综合部',arrival:'不存在的城市'}});
    assert(reply.ok,reply.error);assert(reply.written.length===8&&reply.pending.length===8,'未逐字段继续或提示未知选项');
    assert(w.MockForm.rows.detail_1.every(row=>w.WfForm.getFieldValue(`field21326_${row}`)==='dept-admin'),'有效部门未保留');
  });
  await run('业务招待单只写票种税率金额税额，客运普票零抵扣，部门成本中心可批量选',async()=>{
    const w=await load();
    w.WfForm.getBaseInfo=()=>({workflowid:'231',requestid:'business-case'});
    w.MockForm.setSource('4','发票内容','*运输服务*客运服务费');
    const read=await w.JdlExpenseAdapter.run('read');assert(read.ok,read.error);
    assert(read.snapshot.workflowId==='231'&&Object.keys(read.snapshot.fields).sort().join(',')==='amount,costCenter,department,property,rate,tax','业务表单字段集合错误');
    const plan=calculateAutomatic(read.snapshot);
    assert(plan.groups.length===4&&plan.totals.amountCents===301690&&plan.totals.taxCents===7800,'业务分组或抵扣金额错误');
    assert(plan.groups.find(g=>g.key==='其他|普票|0%|通用').invoices.some(i=>i.content.includes('客运服务费')),'客运普票未并入其他普票');
    const applied=await w.JdlExpenseAdapter.run('automatic',plan);assert(applied.ok,applied.error);
    assert(applied.rows.length===4,'业务事项未全部填入');
    assert(w.MockForm.apiCalls().filter(call=>call.type==='change').every(call=>!/^field213(?:13|14|15|20|31)_/.test(call.mark)),'业务事项误写差旅字段');
    const options=await w.JdlExpenseAdapter.run('sharedOptions');assert(options.ok,options.error);
    assert(options.fields.join(',')==='department,costCenter'&&!options.options.departure,'业务单不应显示城市公共字段');
    const shared=await w.JdlExpenseAdapter.run('applyShared',{context:options.context,fingerprint:options.fingerprint,values:{department:'明阳智慧综合部',costCenter:'深圳佳利达',departure:'深圳'}});
    assert(shared.ok&&shared.written.length===8,'部门及成本中心未批量填写');
    assert(w.MockForm.rows.detail_1.every(row=>!w.WfForm.getFieldValue(`field21313_${row}`)),'业务单误填出发城市');
  });
  await run('日常费用单按福利费合并普票并按税率拆专票，只保留部门成本中心批量字段',async()=>{
    const w=await load();w.WfForm.getBaseInfo=()=>({workflowid:'232',requestid:'daily-case'});
    w.MockForm.values.set('field21220','1526.66');
    const selected=w.document.createElement('span');selected.id='field21214span';selected.textContent='薪酬福利';w.document.body.append(selected);
    w.MockForm.values.set('field21214','66');
    for(const row of w.MockForm.rows.detail_3)w.MockForm.setSource(row,'发票内容','员工团建物资');
    for(const root of w.document.querySelectorAll('#oTable0 [data-fieldname="fyxl1"]')){
      root.dataset.fieldname='fyxl';root.querySelector('select').append(new Option('福利费','welfare-code'));
    }
    for(const root of w.document.querySelectorAll('#oTable0 [data-fieldname="fpzx"]'))root.dataset.fieldname='xfpzx';
    const add=w.WfForm.addDetailRow;
    w.WfForm.addDetailRow=(detail,initial)=>{add(detail,initial);const row=w.MockForm.rows.detail_1.at(-1);const root=w.document.querySelector(`[data-fieldmark="field21331_${row}"]`);root.dataset.fieldname='fyxl';root.querySelector('select').append(new Option('福利费','welfare-code'));};
    const read=await w.JdlExpenseAdapter.run('read');assert(read.ok,read.error);
    assert(read.snapshot.workflowId==='232'&&Object.keys(read.snapshot.fields).sort().join(',')==='amount,costCenter,department,property,rate,smallCategory,tax','日常单字段结构错误');
    const plan=calculateAutomatic(read.snapshot);assert(plan.groups.length===3,'普票或专票分组错误');
    assert(plan.groups.find(group=>group.key==='其他|普票|0%|通用|福利费').attachmentAmountCents===152666,'附件金额未并入普票');
    assert(plan.warnings.some(item=>item.includes('附件票种未核实')),'未提示附件票种未核实');
    const applied=await w.JdlExpenseAdapter.run('automatic',plan);assert(applied.ok,applied.error);
    assert(applied.rows.length===3,'日常事项未写全');
    assert(applied.rows.every(row=>w.WfForm.getFieldValue(`field21331_${row}`)==='welfare-code'),'未统一填写福利费');
    assert(w.MockForm.apiCalls().filter(call=>call.type==='change').every(call=>!/^field213(?:13|14|15|20)_/.test(call.mark)),'日常事项误写差旅字段');
    const options=await w.JdlExpenseAdapter.run('sharedOptions');assert(options.ok&&options.fields.join(',')==='department,costCenter','日常单公共字段范围错误');
  });
  await run('日常办公内容自动选择日常费用大类与日常办公费，混合税率专票跳过',async()=>{
    const w=await load();w.WfForm.getBaseInfo=()=>({workflowid:'232',requestid:'office-case'});
    const category=w.document.createElement('div');category.dataset.fieldmark='field21214';category.dataset.fieldname='fydl';
    const select=w.document.createElement('select');select.id='field21214';select.append(new Option('',''),new Option('日常费用','daily-code'),new Option('薪酬福利','welfare-code'));category.append(select);w.document.body.append(category);
    for(const root of w.document.querySelectorAll('#oTable0 [data-fieldname="fyxl1"]')){
      root.dataset.fieldname='fyxl';root.querySelector('select').append(new Option('日常办公费','office-code'));
    }
    for(const root of w.document.querySelectorAll('#oTable0 [data-fieldname="fpzx"]'))root.dataset.fieldname='xfpzx';
    for(const row of w.MockForm.rows.detail_3){
      w.MockForm.setSource(row,'发票内容','计算机外部设备U盘');
      w.MockForm.setSource(row,'发票类型','电子发票（增值税普通发票）');
    }
    w.MockForm.setSource('0','发票内容','快递费,纸制品');w.MockForm.setSource('0','发票类型','电子发票（增值税专用发票）');
    w.MockForm.setSource('0','发票税率','6.00%,13.00%');
    const read=await w.JdlExpenseAdapter.run('read');assert(read.ok,read.error);
    const plan=calculateAutomatic(read.snapshot);assert(plan.dailyBigCategory==='日常费用'&&plan.groups.length===1,'办公费用途分类错误');
    assert(plan.skippedInvoices.length===1&&plan.skippedInvoices[0].row==='0','多税率专票没有安全跳过');
    const applied=await w.JdlExpenseAdapter.run('automatic',plan);assert(applied.ok,applied.error);
    assert(w.WfForm.getFieldValue('field21214')==='daily-code','费用大类未选日常费用');
    assert(applied.rows.every(row=>w.WfForm.getFieldValue(`field21331_${row}`)==='office-code'),'费用小类未选日常办公费');
  });
  await run('日常费用单混合办公与福利时只填明确事项，整单大类待补',async()=>{
    const w=await load();w.WfForm.getBaseInfo=()=>({workflowid:'232',requestid:'mixed-case'});
    for(const row of [...w.MockForm.rows.detail_3].slice(2))w.MockForm.removeSource(row);
    w.MockForm.setSource('0','发票内容','办公用品装订');w.MockForm.setSource('2','发票内容','员工福利生日蛋糕');
    const decorate=root=>{root.dataset.fieldname='fyxl';root.querySelector('select').append(new Option('日常办公费','office-code'),new Option('福利费','welfare-code'));};
    for(const root of w.document.querySelectorAll('#oTable0 [data-fieldname="fyxl1"]'))decorate(root);
    for(const root of w.document.querySelectorAll('#oTable0 [data-fieldname="fpzx"]'))root.dataset.fieldname='xfpzx';
    const add=w.WfForm.addDetailRow;w.WfForm.addDetailRow=(detail,initial)=>{add(detail,initial);const row=w.MockForm.rows.detail_1.at(-1);decorate(w.document.querySelector(`[data-fieldmark="field21331_${row}"]`));};
    const read=await w.JdlExpenseAdapter.run('read');assert(read.ok,read.error);
    const plan=calculateAutomatic(read.snapshot);assert(plan.ready&&plan.groups.length===2&&plan.dailyBigCategory==='','混合用途分组错误');
    const applied=await w.JdlExpenseAdapter.run('automatic',plan);assert(applied.ok,applied.error);
    assert(applied.rows.length===2&&applied.pending.some(item=>item.includes('待补费用大类')),'未留大类待补');
    const small=applied.rows.map(row=>w.WfForm.getFieldValue(`field21331_${row}`)).sort();
    assert(small.join(',')==='office-code,welfare-code','两项明确小类未写入');
  });
  document.getElementById('status').textContent=`测试完成：${passed} 通过，${failed} 失败`;document.getElementById('run').disabled=false;
}
document.getElementById('run').addEventListener('click',suite);
