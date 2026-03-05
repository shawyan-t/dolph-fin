import { getCompanyFacts } from './packages/mcp-sec-server/dist/tools/get-company-facts.js';
import { calculateRatios } from './packages/mcp-financials-server/dist/math/ratios.js';
import { normalizeToStatements } from './packages/mcp-financials-server/dist/xbrl/normalizer.js';

const tickers = ['GOOG', 'GOOGL', 'MSFT', 'RTX'];
const metrics = [
  'revenue','net_income','operating_income','gross_profit','cost_of_revenue','operating_expenses',
  'total_debt','long_term_debt','short_term_debt','stockholders_equity','shares_outstanding',
  'inventory','current_assets','current_liabilities'
];

for (const t of tickers) {
  const facts = await getCompanyFacts({ ticker: t });
  console.log('\n=== ' + t + ' ===');
  for (const m of metrics) {
    const f = facts.facts.find(x => x.metric === m);
    if (!f) {
      console.log(m + ' MISSING');
      continue;
    }
    const ps = f.periods.slice(0, 3).map(p => p.period + '|' + p.form + '|' + p.value);
    console.log(m + ' ' + ps.join(' ; '));
  }

  const ratios = calculateRatios(facts, ['de','current_ratio','quick_ratio','gross_margin','operating_margin','net_margin','bvps']);
  console.log('RATIOS ' + JSON.stringify(ratios, null, 2));

  const inc = normalizeToStatements(facts, 'income', 'annual', 3);
  const bal = normalizeToStatements(facts, 'balance_sheet', 'annual', 3);
  console.log('INC_PERIODS ' + JSON.stringify(inc.periods.map(p => p.period)));
  console.log('BAL_PERIODS ' + JSON.stringify(bal.periods.map(p => p.period)));
}
