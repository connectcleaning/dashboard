-- "Total Spend" should reflect true operating costs, not money movements that
-- aren't expenses. Exclude owner draws/investments, equity, account transfers
-- (credit-card / bank payments), and income categories.
--
-- ad_spend / ad_spend_by_channel are unaffected (they already match specific
-- advertising categories), so this only cleans up the spend totals.

create or replace view marts.fact_operating_spend as
select *
from marts.fact_spend
where category is null
   or (
        category not ilike '%owner draw%'
    and category not ilike '%owner investment%'
    and category not ilike '%opening balance equity%'
    and category not ilike '%personal expense%'
    and category not ilike '%payments to deposit%'
    and category not ilike 'sales:%'           -- revenue / customer refunds
    and category not ilike '%other income%'    -- income, incl. cc rewards
    and category <> 'DISCOVER Credit Card'     -- credit-card payment (transfer)
    and category not ilike 'Blue Business Cash%' -- credit-card payment (transfer)
    and category not ilike 'Checking%'         -- bank transfer
   );

-- Point the spend totals at the operating-only base.
create or replace view marts.monthly_spend as
select month, sum(amount) as total_spend, count(*) as line_items
from marts.fact_operating_spend
where month is not null
group by 1
order by 1;

create or replace view marts.spend_by_category as
select month, coalesce(category, 'Uncategorized') as category, sum(amount) as spend
from marts.fact_operating_spend
where month is not null
group by 1, 2
order by 1, 3 desc;
