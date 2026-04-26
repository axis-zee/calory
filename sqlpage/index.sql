-- Title bar
select 'shell' as component,
    'Calory Tracker' as title,
    '' as link,
    '' as lang,
    'Track your keto diet macros' as description;

-- Hero
select 'hero' as component,
    'Calory Tracker' as title,
    'Keto diet macros tracked from your diary.md' as description;

-- Stats
SELECT 'card' AS component,
    'Day ' || day_num AS title,
    '' AS link,
    '' AS link_label
FROM days
WHERE kcal > 0
ORDER BY day_num DESC;
