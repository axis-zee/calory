-- Title bar
select 'shell' as component,
    'Rolling 7-Day Average' as title,
    '' as link,
    '' as lang,
    'Weekly moving average of calories' as description;

-- Stats cards for each day showing the 7-day rolling average
SELECT 'card' AS component,
    'Day ' || day_num AS title,
    '7-day avg: ' || printf('%.0f', rolling_avg) || ' kcal' AS description
FROM (
    SELECT d1.day_num,
        SUM(d2.kcal * 1.0) / COUNT(d2.kcal) AS rolling_avg
    FROM days d1
    JOIN days d2 ON d2.day_num <= d1.day_num
        AND d2.day_num > d1.day_num - 7
        AND d2.kcal > 0
    WHERE d1.kcal > 0
    GROUP BY d1.day_num
    ORDER BY d1.day_num
);
