import { edgarFetchJson } from './packages/mcp-sec-server/dist/edgar/client.js';
import { SEC_XBRL_COMPANY_FACTS_URL } from './packages/shared/dist/constants.js';

async function show(cik, label){
  const url = SEC_XBRL_COMPANY_FACTS_URL.replace('{cik}', cik);
  const data = await edgarFetchJson(url);
  const us = data.facts?.['us-gaap'] || {};

  function latest(tag){
    const fact = us[tag];
    if(!fact || !fact.units) return null;
    const vals=[];
    for (const [unit,arr] of Object.entries(fact.units)){
      for (const e of arr){
        if(['10-K','20-F','40-F'].includes(e.form)) vals.push({end:e.end,form:e.form,unit,val:e.val});
      }
    }
    vals.sort((a,b)=>b.end.localeCompare(a.end));
    return vals[0] || null;
  }

  const tags=[
    'RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet',
    'GrossProfit','CostOfGoodsAndServicesSold','OperatingExpenses','OperatingIncomeLoss','NetIncomeLoss',
    'CommonStockSharesOutstanding','WeightedAverageNumberOfShareOutstandingBasicAndDiluted','WeightedAverageNumberOfDilutedSharesOutstanding','EntityCommonStockSharesOutstanding',
    'LongTermDebt','LongTermDebtNoncurrent','LongTermDebtAndCapitalLeaseObligations','DebtAndCapitalLeaseObligations','DebtCurrent','LongTermDebtCurrent','ShortTermBorrowings'
  ];

  console.log('\n===',label,'===');
  for (const tag of tags){
    const l=latest(tag);
    if(l) console.log(tag, l.end, l.form, l.unit, l.val);
  }
}

await show('0000101829','RTX');
await show('0001652044','GOOG');
