import { loadEmployees, loadDepartments, loadShifts } from './api.js';

async function run() {
  const employees = await loadEmployees();
  const departments = await loadDepartments();
  const shifts = await loadShifts(2026, 3);

  console.log("EMP:", employees);
  console.log("DEPT:", departments);
  console.log("SHIFTS:", shifts);
}

run();