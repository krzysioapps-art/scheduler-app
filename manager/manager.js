window.schedules = {};

window.YEAR = 2026;
window.MONTH = 3;
window.DAYS = new Date(window.YEAR, window.MONTH, 0).getDate();
window.requests = {};
async function loadEmployees() {
    const { data } = await client
        .from('employees')
        .select('*')
        .eq('is_active', true);

    return data.map(e => ({
        id: String(e.id),
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
    for (let d = 1; d <= DAYS; d++) s[d] = null;
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

async function loadRequests(year, month) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 0);
    const end = endDate.toISOString().split("T")[0];

    const { data } = await client
        .from('shift_requests')
        .select('*')
        .gte('date', start)
        .lte('date', end);

    const map = {};

    data.forEach(r => {
        const day = new Date(r.date).getDate();
        const empId = String(r.employee_id);

        if (!map[empId]) map[empId] = {};

        map[empId][day] = {
            id: r.id,
            start: r.start_time,
            end: r.end_time,
            status: r.status
        };
    });

    return map;
}

function formatRequest(req) {
    if (!req) return "";

    if (!req.start && !req.end) {
        return "OFF";
    }

    return `${req.start?.slice(0, 5)}-${req.end?.slice(0, 5)}`;
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
    window.requests = await loadRequests(YEAR, MONTH);
    iframe.contentWindow.postMessage({
        type: "init",
        data: {
            employees,
            departments,
            schedules,
            requests,
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
        // 🔥 NIE ruszaj requesta jeśli nie możesz zmienić zmiany
        return false;
    }

    const newShift = { start, end, departmentId };

    const errors = validateShift(schedules, employeeId, day, newShift);

    if (errors.length > 0) {
        sendError(employeeId, day, errors);
        return false;
    }

    const date = buildDate(YEAR, MONTH, day);

    const { data, error } = await client
        .from("shifts")
        .upsert({
            employee_id: employeeId,
            date,
            start,
            end,
            department_id: departmentId
        }, {
            onConflict: 'employee_id,date'
        });



    if (error) {
        console.error("SUPABASE ERROR FULL:", error);
        console.error("MESSAGE:", error.message);
        console.error("DETAILS:", error.details);

        sendError(employeeId, day, [
            error.message || "Błąd zapisu"
        ]);

        return false;
    }

    // 🔵 UPDATE REQUEST STATUS
    const req = requests?.[String(employeeId)]?.[day];

    if (req && canModifyShift(existing, departmentId)) {
        let newStatus = "rejected";

        if (
            req.start?.padStart(5, "0") === start?.padStart(5, "0") &&
            req.end?.padStart(5, "0") === end?.padStart(5, "0")
        ) {
            newStatus = "accepted";
        }

        await client
            .from("shift_requests")
            .update({ status: newStatus })
            .eq("id", req.id);

        requests[String(employeeId)][day].status = newStatus;
    }

    const key = `${employeeId}_${day}`;
    delete errorMap[key];

    return true;
}

function validateShift(schedules, employeeId, day, newShift) {
    const year = YEAR;
    const month = MONTH;

    const errors = [];

    if (!newShift) return errors;

    const employeeSchedule = schedules[employeeId] || {};

    const prev = day > 1 ? employeeSchedule[day - 1] : null;
    const next = day < DAYS ? employeeSchedule[day + 1] : null;

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
    if (weekHours > 40.01) {
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

    for (let d = day + 1; d <= DAYS; d++) {
        const s = schedules[empId]?.[d];
        if (s && s.start) count++;
        else break;
    }

    return count;
}

function getWeekHoursWithNew(schedules, empId, day, newShift) {
    const date = new Date(YEAR, MONTH - 1, day);

    // znajdź poniedziałek
    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (dayOfWeek - 1));

    let hours = 0;

    for (let i = 0; i < 7; i++) {
        const current = new Date(monday);
        current.setDate(monday.getDate() + i);

        const d = current.getDate();
        const m = current.getMonth() + 1;

        if (m !== MONTH) continue; // ignoruj inne miesiące

        let shift;

        if (d === day) {
            shift = newShift;
        } else {
            shift = schedules[empId]?.[d];
        }

        if (shift && shift.start) {
            hours += getShiftHours(YEAR, MONTH, d, shift);
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

function sendError(employeeId, day, errors) {
    if (window.showError) {
        window.showError({ employeeId, day, errors });
    } else {
        console.warn("Brak showError w window");
    }
}

window.calculateStats = function (schedules) {
    const stats = {};

    for (const empId in schedules) {
        let totalHours = 0;
        let workingDays = 0;

        const departmentStats = {};
        const schedule = schedules[empId];

        for (let day = 1; day <= DAYS; day++) {
            const shift = schedule[day];
            if (!shift || !shift.start) continue;

            const hours = getShiftHours(YEAR, MONTH, day, shift);

            totalHours += hours;
            workingDays++;

            if (!departmentStats[shift.departmentId]) {
                departmentStats[shift.departmentId] = {
                    hours: 0,
                    days: 0
                };
            }

            departmentStats[shift.departmentId].hours += hours;
            departmentStats[shift.departmentId].days += 1;
        }

        stats[empId] = {
            totalHours: Math.round(totalHours * 10) / 10,
            workingDays,
            departmentStats
        };
    }

    return stats;
}

window.calculateDepartmentTotals = function (schedules) {
    const totals = {};

    for (const empId in schedules) {
        const schedule = schedules[empId];

        for (let day = 1; day <= DAYS; day++) {
            const shift = schedule[day];
            if (!shift || !shift.start) continue;

            const hours = getShiftHours(YEAR, MONTH, day, shift);
            const dept = shift.departmentId;

            if (!totals[dept]) {
                totals[dept] = { hours: 0, days: 0 };
            }

            totals[dept].hours = Math.round((totals[dept].hours + hours) * 10) / 10;
            totals[dept].days += 1;
        }
    }

    return totals;
}

window.getMonthNorm = function (year, month) {
    let workDays = 0;

    for (let d = 1; d <= DAYS; d++) {
        const date = new Date(year, month - 1, d);

        const day = date.getDay();
        if (day !== 0 && day !== 6) {
            workDays++;
        }
    }

    return {
        maxDays: workDays,
        maxHours: workDays * 8
    };
}

