export function calculateTarget(p) {
  if (!p || p.age < 18 || p.age > 100 || p.heightCm < 100 || p.heightCm > 250 || p.weightKg < 30 || p.weightKg > 350 || p.specialCare || !['female', 'male'].includes(p.gender)) return null;
  const factor = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[p.activity];
  if (!factor) return null;
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.gender === 'male' ? 5 : -161);
  const energy = bmr * factor;
  const calories = Math.round(Math.max(p.gender === 'male' ? 1500 : 1200, energy + ({ lose: -300, gain: 300 }[p.goal] ?? 0)));
  const protein = Math.round(p.weightKg * (p.goal === 'gain' ? 1.6 : 1.2));
  const fat = Math.round(calories * .3 / 9);
  return { bmr: Math.round(bmr), energy: Math.round(energy), calories, protein, fat, carbs: Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4)), fiber: 30 };
}
