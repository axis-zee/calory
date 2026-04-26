-- Title bar
select 'shell' as component,
    'Day ' || CAST($page AS INTEGER) AS title,
    '' as link,
    '' as lang,
    'Daily meal details' as description;

-- Day header card
SELECT 'card' AS component,
    'Day ' || day_num AS title,
    '' AS link,
    '' AS link_label
FROM days
WHERE day_num = $page;

-- Day stats
SELECT 'table' AS component,
    metric AS "Metric",
    value AS "Value"
FROM (
    SELECT 'Kcal' AS metric, COALESCE(CAST(kcal AS TEXT), '-') AS value FROM days WHERE day_num = $page
    UNION ALL SELECT 'Protein', COALESCE(CAST(protein AS TEXT), '-') || 'g' FROM days WHERE day_num = $page
    UNION ALL SELECT 'Fat', COALESCE(CAST(fat AS TEXT), '-') || 'g' FROM days WHERE day_num = $page
    UNION ALL SELECT 'Net Carbs', COALESCE(CAST(net_carbs AS TEXT), '-') || 'g' FROM days WHERE day_num = $page
);

-- Subtotals
SELECT 'card' AS component,
    name AS title,
    '' AS link,
    '' AS link_label
FROM meals
WHERE day_num = $page AND grams = 0
ORDER BY name;
