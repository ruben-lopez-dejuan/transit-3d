import { cityRegistry, cityPackageReports } from './cities';
for (const city of cityRegistry.getCities()) console.log(`${city.id}: ${city.name} · ${city.providers.length} operadores`);
if (cityPackageReports.some((report) => report.state === 'invalid')) process.exitCode = 1;
console.log('Validación de formato terminada. Los feeds se consultan al usar la ciudad; esta comprobación no verifica su disponibilidad.');
