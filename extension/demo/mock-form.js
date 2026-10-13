/* Local fixture models WfForm and deliberately uses non-sequential option codes. */
(() => {
  const FIELDS = {jzbm:'field21326',fyxl1:'field21331',cbzx:'field21325',cfdd:'field21313',dddd:'field21314',tlts:'field21315',fymx:'field21320',fpzx:'field21332',sl:'field21323',bxje:'field21319',se:'field21324',wsje:'field21318'};
  const HEADERS = ['发票号码','购买方','发票内容','发票类型','发票税率','发票价税合计','发票未税金额','发票税额'];
  const NAMES = ['fphm','gmf','fpnr','fplx','fpsl','jshj','wsje','fpse'];
  const SOURCE_FIELDS = HEADERS.map((_,index)=>`field${30000+index}`);
  const choices = {
    jzbm:[['dept-admin','明阳智慧综合部'],['dept-sales','客户服务部']],
    cbzx:[['cost-shenzhen','深圳佳利达'],['cost-other','其他成本中心']],
    fyxl1:[['travel-domestic','国内差旅']],
    cfdd:[['city-sh','上海'],['city-sz','深圳'],['city-bj','北京']],
    dddd:[['city-sh','上海'],['city-sz','深圳'],['city-bj','北京']],
    fymx:[['exp-travel','交通费'],['exp-hotel','住宿费'],['exp-meal','餐费'],['exp-other','其他费用']],
    fpzx:[['special-code','专票'],['ordinary-code','普票'],['taxi-code','电子打车票']],
    sl:[['rate-13','13%'],['rate-9','9%'],['rate-6','6%'],['rate-3','3%'],['rate-1','1%'],['rate-0','0%'],['exempt','免税'],['outside','不征税']]
  };
  const samples = [
    ['MOCK-0001','汽油92号车用汽油','电子发票（增值税普通发票）','13%','391.00','346.02','44.98'],
    ['MOCK-0002','汽油92号车用汽油','电子发票（增值税普通发票）','13%','375.00','331.86','43.14'],
    ['MOCK-0003','高速公路通行费','电子发票（增值税普通发票）','3%','103.00','100.00','3.00'],
    ['MOCK-0004','停车费','电子发票（增值税普通发票）','0%','50.00','50.00','0.00'],
    ['MOCK-0005','旅客运输服务','电子发票（增值税专用发票）','9%','218.00','200.00','18.00'],
    ['MOCK-0006','住宿服务客房费','电子发票（增值税专用发票）','6%','1060.00','1000.00','60.00'],
    ['MOCK-0007','住宿服务客房费','电子发票（增值税普通发票）','6%','530.00','500.00','30.00'],
    ['MOCK-0008','餐饮服务餐费','电子发票（增值税普通发票）','6%','212.00','200.00','12.00'],
    ['MOCK-0009','计算机外部设备U盘','电子发票（增值税普通发票）','1%','77.90','77.13','0.77']
  ];
  const values = new Map();
  const rows = {detail_1:[],detail_3:[],detail_7:[]};
  let nextIndex = 0;
  let rejectField = '';
  let apiCalls = [];
  let sourceContext = 'mock-request';
  let ordinaryRatesZero = false;

  function wrapper(mark,name,cellmark) {
    const root = document.createElement('div');
    root.dataset.fieldmark=mark;root.dataset.fieldname=name;root.dataset.cellmark=cellmark;
    return root;
  }
  function addExpense(row) {
    const tr = document.createElement('tr');tr.dataset.rowindex=String(row);tr.className='detail_data_row';
    const number = document.createElement('td');number.textContent=String(rows.detail_1.length+1);tr.append(number);
    for(const [index,[name,field]] of Object.entries(Object.entries(FIELDS))) {
      const mark=`${field}_${row}`;const td=document.createElement('td');const root=wrapper(mark,name,`detail_1_3_${Number(index)+1}`);
      let input;
      if(choices[name]) {input=document.createElement('select');input.append(new Option('',''));for(const [value,label] of choices[name])input.append(new Option(label,value));root.className='wea-select';}
      else {input=document.createElement('input');input.type='text';}
      input.id=mark;input.value='';values.set(mark,'');
      input.addEventListener('change',()=>{values.set(mark,input.value);recalculate(row);});
      root.append(input);td.append(root);tr.append(td);
    }
    document.querySelector('#oTable0 tbody').append(tr);rows.detail_1.push(String(row));
  }
  function recalculate(row) {
    const amount = Number(values.get(`field21319_${row}`)||0);const tax=Number(values.get(`field21324_${row}`)||0);
    const mark=`field21318_${row}`;values.set(mark,(amount-tax).toFixed(2));
    const input=document.getElementById(mark);if(input)input.value=values.get(mark);
  }
  function addInvoice(sample,index) {
    const row=String(index*2);rows.detail_3.push(row);const tr=document.createElement('tr');tr.className='detail_data_row';tr.dataset.rowindex=row;
    const check=document.createElement('td');const cb=document.createElement('input');cb.type='checkbox';cb.checked=index===1;check.append(cb);tr.append(check);
    const seq=document.createElement('td');seq.textContent=String(index+1);tr.append(seq);
    const data=[sample[0],'模拟公司',sample[1],sample[2],sample[3],sample[4],sample[5],sample[6]];
    data.forEach((value,column)=>{const td=document.createElement('td');const mark=`${SOURCE_FIELDS[column]}_${row}`;values.set(mark,value);const root=wrapper(mark,NAMES[column],`detail_3_3_${column+2}`);root.textContent=value;td.append(root);tr.append(td);});
    document.querySelector('#oTable2 tbody').append(tr);
  }
  function reset() {
    values.clear();Object.keys(rows).forEach(key=>rows[key]=[]);nextIndex=0;rejectField='';apiCalls=[];sourceContext='mock-request';
    document.querySelectorAll('.excelDetailTable tbody').forEach(body=>body.replaceChildren());
    values.set('field21403','3');document.getElementById('demo-days').value='3';document.getElementById('field21403span').textContent='3';
    samples.forEach(addInvoice);addExpense(String(nextIndex++));
    const tr=document.createElement('tr');tr.dataset.rowindex='0';tr.className='detail_data_row';const seq=document.createElement('td');seq.textContent='1';const td=document.createElement('td');const root=wrapper('field40000_0','fysm','detail_7_3_1');root.textContent='上海到深圳';td.append(root);tr.append(seq,td);document.querySelector('#oTable6 tbody').append(tr);values.set('field40000_0','上海到深圳');rows.detail_7=['0'];
    document.getElementById('mock-status').textContent='尚未填写费用事项';
  }
  window.WfForm={
    getBaseInfo:()=>({workflowid:'230',requestid:sourceContext}),
    getFieldValue:mark=>values.get(mark)||'',
    getDetailAllRowIndexStr:detail=>rows[detail].join(','),
    convertFieldNameToId:(name,detail)=>detail==='detail_1'?FIELDS[name]:'field21403',
    getFieldCurViewAttr:()=>2,
    changeFieldValue:(mark,info)=>{
      apiCalls.push({type:'change',mark,value:info.value});
      if(mark===rejectField)throw new Error('模拟系统拒绝字段写入');
      values.set(mark,String(info.value));const input=document.getElementById(mark);if(input)input.value=String(info.value);
      if (ordinaryRatesZero && /^field21332_\d+$/.test(mark)) {
        const row=mark.split('_')[1]; const rate=document.getElementById(`field21323_${row}`);
        if (rate) {
          rate.replaceChildren(new Option('',''));
          for (const [value,label] of choices.sl.filter(([value])=>info.value!=='ordinary-code'||value==='rate-0')) rate.append(new Option(label,value));
          values.set(`field21323_${row}`,'');
        }
      }
      const span=document.getElementById(`${mark}span`);if(span)span.textContent=info.value;
      const root=document.querySelector(`[data-fieldmark="${mark}"]`);const selected=root?.querySelector('.ant-select-selection-selected-value');
      if(selected){const option=choices[root.dataset.fieldname]?.find(([value])=>value===String(info.value));selected.textContent=option?.[1]||'';selected.title=selected.textContent;}
      const match=/_(\d+)$/.exec(mark);if(match)recalculate(match[1]);
      document.getElementById('mock-status').textContent=`费用事项 ${rows.detail_1.length} 行，已更新`;
    },
    addDetailRow:(detail,initial={})=>{if(detail!=='detail_1')throw new Error('禁止修改来源表');const row=String(nextIndex++);apiCalls.push({type:'add',row});addExpense(row);for(const [field,info]of Object.entries(initial))window.WfForm.changeFieldValue(`${field}_${row}`,info);},
    delDetailRow:(detail,row)=>{if(detail!=='detail_1')throw new Error('禁止删除来源发票');apiCalls.push({type:'delete',row});rows.detail_1=rows.detail_1.filter(value=>value!==row);document.querySelector(`#oTable0 tr[data-rowindex="${row}"]`)?.remove();}
  };
  document.getElementById('reset').addEventListener('click',()=>{reset();delete window.JdlExpenseAdapter;location.reload();});
  document.getElementById('demo-days').addEventListener('input',event=>{values.set('field21403',event.target.value);document.getElementById('field21403span').textContent=event.target.value;});
  document.getElementById('remove-invoices').addEventListener('click',()=>{
    for(const tr of document.querySelectorAll('#oTable2 tr[data-rowindex]'))if(tr.querySelector('input[type=checkbox]').checked){rows.detail_3=rows.detail_3.filter(row=>row!==tr.dataset.rowindex);tr.remove();}
  });
  window.MockForm={reset,values,rows,apiCalls:()=>apiCalls,failAt:mark=>{rejectField=mark;},setContext:value=>{sourceContext=value;},removeSource:row=>{rows.detail_3=rows.detail_3.filter(value=>value!==row);document.querySelector(`#oTable2 tr[data-rowindex="${row}"]`).remove();},setSource:(row,label,value)=>{const mark=`${SOURCE_FIELDS[HEADERS.indexOf(label)]}_${row}`;values.set(mark,value);document.querySelector(`[data-fieldmark="${mark}"]`).textContent=value;}};
  reset();
  window.MockForm.setOrdinaryRatesZero = () => { ordinaryRatesZero = true; };
})();
