export function compactReport(report) {
  const months = new Map();
  for (const day of report.days) {
    const key = day.date.slice(0, 7);
    const row = months.get(key) ?? { month: key, calories: 0, protein: 0, meals: 0, loggedDays: 0 };
    row.calories += day.calories; row.protein += day.protein; row.meals += day.mealCount;
    if (day.mealCount) row.loggedDays++;
    months.set(key, row);
  }
  const { days, ...stats } = report;
  return { ...stats, monthTotals: [...months.values()] };
}
