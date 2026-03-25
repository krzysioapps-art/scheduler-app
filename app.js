window.schedules = {};

let isSaving = false;

window.YEAR = 2026;
window.MONTH = 3;

const { createClient } = supabase;

const client = createClient(
    'https://kvelgklioybeofkzbvpy.supabase.co',
    'sb_publishable_c4skpqhBjxU7a_cWc4bLMQ_knA7vfZs'
);

async function loadEmployees() {
    const { data } = await client
        .from('employees')
        .select('*')
        .eq('is_active', true);

    return data.map(e => ({
        id: e.id,
        name: e.name,
        managerId: e.manager_id
    }));
}

async function loadDepartments() {
    const { data } = await client
        .from('departments')
        .select('*')
        .eq('is_active', true);

    return data.map(d => ({
        id: d.id,
        name: d.name,
        managerId: d.manager_id
    }));
}

function createEmptySchedule() {
    const s = {};
    for (let d = 1; d <= 31; d++) s[d] = null;
    return s;
}

async function loadShifts(year, month) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 0);
    const end = endDate.toISOString().split("T")[0];

    const { data } = await client
        .from('shifts')
        .select('*')
        .gte('date', start)
        .lte('date', end);

    const map = {};

    data.forEach(item => {
        const day = new Date(item.date).getDate();
        const empId = String(item.employee_id);

        if (!map[empId]) map[empId] = createEmptySchedule();

        map[empId][day] = {
            start: item.start,
            end: item.end,
            departmentId: item.department_id
        };
    });

    return map;
}



function buildDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getShift(employeeId, day) {
    return schedules[employeeId]?.[day] || null;
}

function canModifyShift(existing, departmentId) {
    if (!existing) return true;
    return existing.departmentId === departmentId;
}

async function refresh(employeesArg, departmentsArg) {
    const employees = employeesArg || await loadEmployees();
    const departments = departmentsArg || await loadDepartments();
    schedules = await loadShifts(YEAR, MONTH);

    iframe.contentWindow.postMessage({
        type: "init",
        data: {
            employees,
            departments,
            schedules,
            stats: {}, // na razie puste
            norm: {},
            departmentTotals: {},
            visibleEmployeesByDept: {}
        }
    }, "*");
}

function showErrorLocal(employeeId, day, errors) {
    const key = `${employeeId}_${day}`;
    errorMap[key] = errors;
}

async function saveShift({ employeeId, day, departmentId, start, end }) {

    const existing = getShift(employeeId, day);

    if (!canModifyShift(existing, departmentId)) {
        showErrorLocal(employeeId, day, ["Zmiana istnieje w innym dziale"]);
        return false;
    }

    const newShift = { start, end, departmentId };

    const errors = validateShift(schedules, employeeId, day, newShift);

    if (errors.length > 0) {
        sendError(employeeId, day, errors);
        return false;
    }

    const date = buildDate(YEAR, MONTH, day);

    const { error } = await client.from("shifts").upsert({
        id: `${employeeId}_${date}`,
        employee_id: employeeId,
        date,
        start,
        end,
        department_id: departmentId
    });

    if (error) {
        console.error(error);
        sendError(employeeId, day, ["Błąd zapisu"]);
        return false;
    }

    // ✅ update lokalny DOPIERO po sukcesie DB
    if (!schedules[employeeId]) {
        schedules[employeeId] = createEmptySchedule();
    }

    schedules[employeeId][day] = newShift;

    return true;
}

function validateShift(schedules, employeeId, day, newShift) {
    const year = YEAR;
    const month = MONTH;

    const errors = [];

    if (!newShift) return errors;

    const employeeSchedule = schedules[employeeId] || {};

    const prev = day > 1 ? employeeSchedule[day - 1] : null;
    const next = day < 31 ? employeeSchedule[day + 1] : null;

    // 🔴 odpoczynek (poprzedni dzień)
    if (prev && prev.start && prev.end) {
        const rest = getRestHours(prev, newShift, year, month, day - 1, day);
        if (rest < 11) {
            errors.push(`Odpoczynek ${Math.round(rest * 10) / 10}h (<11h)`);
        }
    }

    // 🔴 odpoczynek (następny dzień)
    if (next && next.start && next.end) {
        const rest = getRestHours(newShift, next, year, month, day, day + 1);
        if (rest < 11) {
            errors.push(`Odpoczynek do następnego dnia ${Math.round(rest * 10) / 10}h`);
        }
    }

    // 🔴 streak
    const streak = countStreakWithNew(schedules, employeeId, day);
    if (streak > 6) {
        errors.push(`>6 dni pracy pod rząd`);
    }

    // 🔴 godziny dzienne
    const hours = getShiftHours(year, month, day, newShift);
    if (hours > 12) {
        errors.push(`>12h pracy`);
    }

    // 🔴 tydzień
    const weekHours = getWeekHoursWithNew(schedules, employeeId, day, newShift);
    if (weekHours > 40) {
        errors.push(`>40h w tygodniu (${Math.round(weekHours)})`);
    }

    return errors;
}

function countStreakWithNew(schedules, empId, day) {
    let count = 1;

    for (let d = day - 1; d >= 1; d--) {
        const s = schedules[empId]?.[d];
        if (s && s.start) count++;
        else break;
    }

    for (let d = day + 1; d <= 31; d++) {
        const s = schedules[empId]?.[d];
        if (s && s.start) count++;
        else break;
    }

    return count;
}

function getWeekHoursWithNew(schedules, empId, day, newShift) {
    const year = YEAR;
    const month = MONTH;

    const dayOfWeek = getDayOfWeek(year, month, day);

    const weekStart = day - (dayOfWeek - 1);
    const weekEnd = weekStart + 6;

    let hours = 0;

    for (let d = weekStart; d <= weekEnd; d++) {

        if (d < 1 || d > 31) continue;

        let shift;

        if (d === day) {
            shift = newShift;
        } else {
            shift = schedules[empId]?.[d];
        }

        if (shift && shift.start) {
            hours += getShiftHours(year, month, d, shift);
        }
    }

    return hours;
}

function getDayOfWeek(year, month, day) {
    const date = new Date(year, month - 1, day);
    let d = date.getDay();
    if (d === 0) d = 7;
    return d;
}

function buildDateObj(year, month, day, time) {
    const [h, m] = time.split(":").map(Number);
    return new Date(year, month - 1, day, h, m);
}

function normalizeShift(year, month, day, shift) {
    let start = buildDateObj(year, month, day, shift.start);
    let end = buildDateObj(year, month, day, shift.end);

    if (end <= start) {
        end.setDate(end.getDate() + 1);
    }

    return { start, end };
}

function getShiftHours(year, month, day, shift) {
    const { start, end } = normalizeShift(year, month, day, shift);
    return (end - start) / (1000 * 60 * 60);
}

function getRestHours(prev, next, year, month, prevDay, nextDay) {
    const a = normalizeShift(year, month, prevDay, prev);
    const b = normalizeShift(year, month, nextDay, next);

    return (b.start - a.end) / (1000 * 60 * 60);
}