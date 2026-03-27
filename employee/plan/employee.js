const client = window.client;

const YEAR = 2026;
const MONTH = 3;
const DAYS = new Date(YEAR, MONTH, 0).getDate();

let EMP_ID = null;
let requests = {};
let schedules = {};
let saveTimeouts = {};

// =====================
// INIT
// =====================

window.addEventListener("load", async () => {
    const { data: { user } } = await client.auth.getUser();

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    const { data } = await client
        .from("employees")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();

    EMP_ID = String(data.id);

    init();
});

async function setEmployee() {
    const val = document.getElementById("empIdInput")?.value?.trim();

    if (!val) {
        alert("Podaj ID");
        return;
    }

    EMP_ID = val;
    localStorage.setItem("emp_id", val);

    init();
}

async function init() {
    const [req, sh] = await Promise.all([
        loadRequests(YEAR, MONTH),
        loadShifts(YEAR, MONTH)
    ]);

    requests = req;
    schedules = sh;

    renderCalendar();
    if (window.renderHeader) await window.renderHeader();
}

// =====================
// RENDER
// =====================

function renderCalendar() {
    const el = document.getElementById("calendar");
    el.innerHTML = "";

    const offset = getFirstDayOffset(YEAR, MONTH);

    const days = ["Pn", "Wt", "Śr", "Czw", "Pt", "Sb", "Nd"];

    days.forEach((d, i) => {
        const headerCell = document.createElement("div");
        headerCell.className = "day-header";
        headerCell.innerText = d;

        if (i === 5) headerCell.classList.add("saturday");
        if (i === 6) headerCell.classList.add("sunday");

        el.appendChild(headerCell);
    });

    for (let i = 0; i < offset; i++) {
        const empty = document.createElement("div");
        empty.className = "empty";
        el.appendChild(empty);
    }

    for (let d = 1; d <= DAYS; d++) {
        const cell = document.createElement("div");
        cell.className = "day";

        const req = requests?.[EMP_ID]?.[d];
        const shift = schedules?.[EMP_ID]?.[d];

        const wrapper = document.createElement("div");
        wrapper.className = "day-inner";

        const { dow } = getDayShortLabel(d);

        const dayNum = document.createElement("div");
        dayNum.className = "day-number";
        dayNum.innerText = d;

        const value = document.createElement("div");
        value.className = "day-value";

        if (shift) {
            value.innerText = `${parseInt(shift.start)}-${parseInt(shift.end)}`;
            value.classList.add("shift");
        } else if (req) {
            value.innerText = formatRequest(req);
        }

        if (req && shift) {
            const badge = document.createElement("div");
            badge.className = "request-badge";
            badge.innerText = formatRequest(req);
            wrapper.appendChild(badge);
        }

        wrapper.appendChild(dayNum);
        wrapper.appendChild(value);
        cell.appendChild(wrapper);

        if (dow === 6) dayNum.classList.add("saturday");
        if (dow === 7) dayNum.classList.add("sunday");

        if (req?.status === "pending") cell.classList.add("pending");
        if (req?.status === "accepted") cell.classList.add("accepted");
        if (req?.status === "rejected") cell.classList.add("rejected");

        cell.onclick = () => handleClick(d);

        el.appendChild(cell);
    }
}

// =====================
// EDIT
// =====================

function editRequest(day) {
    if (!EMP_ID) {
        alert("Najpierw wpisz ID");
        return;
    }

    const val = prompt("Zmiana (np. 8-16 lub OFF)");

    if (val === null) return;

    if (val === "OFF") {
        scheduleSave(day, null, null);
        return;
    }

    const parsed = parseInput(val);

    if (!parsed) {
        alert("Niepoprawny format");
        return;
    }

    scheduleSave(day, parsed.start, parsed.end);
}

// =====================
// SAVE
// =====================

async function saveRequest(day, start, end) {
    const date = buildDate(YEAR, MONTH, day);

    await client
        .from("shift_requests")
        .upsert({
            employee_id: EMP_ID,
            date,
            start_time: start,
            end_time: end,
            status: "pending"
        }, {
            onConflict: 'employee_id,date'
        });


}

// =====================
// HELPERS
// =====================

function parseInput(val) {
    val = val.trim();

    if (/^\d{1,2}$/.test(val)) {
        const s = +val;
        const e = s + 8;
        if (e > 24) return null;

        return {
            start: String(s).padStart(2, '0') + ":00",
            end: String(e).padStart(2, '0') + ":00"
        };
    }

    const m = val.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;

    const s = +m[1];
    const e = +m[2];

    if (s >= e || s < 0 || e > 24) return null;

    return {
        start: String(s).padStart(2, '0') + ":00",
        end: String(e).padStart(2, '0') + ":00"
    };
}

function formatRequest(req) {
    if (!req) return "";
    if (!req.start && !req.end) return "OFF";
    return `${parseInt(req.start)}-${parseInt(req.end)}`;
}

function buildDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

function getNextState(req) {
    if (!req) return { start: "07:00", end: "19:00" };
    if (req.start === "07:00" && req.end === "19:00") return { start: "19:00", end: "07:00" };
    if (req.start === "19:00" && req.end === "07:00") return { start: null, end: null };
    return "clear";
}

async function handleClick(day) {
    if (!EMP_ID) {
        alert("Najpierw wpisz ID");
        return;
    }

    const req = requests?.[EMP_ID]?.[day];

    if (req?.status === "accepted" || req?.status === "rejected") {
        alert("Zmiana została rozpatrzona i nie można jej zmienić");
        return;
    }

    const next = getNextState(req);

    if (next === "clear") {
        const date = buildDate(YEAR, MONTH, day);

        // optimistic update
        if (requests?.[EMP_ID]) {
            delete requests[EMP_ID][day];
        }

        renderCalendar();

        // backend
        await client
            .from("shift_requests")
            .delete()
            .eq("employee_id", EMP_ID)
            .eq("date", date);

        return; // 🔥 KLUCZOWE
    }

    scheduleSave(day, next.start, next.end);
}
function scheduleSave(day, start, end) {
    if (!requests[EMP_ID]) requests[EMP_ID] = {};

    // 🔥 1. natychmiastowy update UI (optimistic)
    requests[EMP_ID][day] = {
        ...requests[EMP_ID]?.[day],
        start,
        end,
        status: "pending"
    };

    renderCalendar();

    // 🔥 2. debounce per dzień
    clearTimeout(saveTimeouts[day]);

    saveTimeouts[day] = setTimeout(() => {
        saveRequest(day, start, end);
    }, 500);
}
function getDayOfWeek(year, month, day) {
    const date = new Date(year, month - 1, day);
    let d = date.getDay();
    if (d === 0) d = 7;
    return d;
}

function getDayShortLabel(day) {
    const map = {
        1: "Pn",
        2: "Wt",
        3: "Śr",
        4: "Czw",
        5: "Pt",
        6: "Sb",
        7: "Nd"
    };

    const dow = getDayOfWeek(YEAR, MONTH, day);
    return {
        label: map[dow],
        dow
    };
}

function getFirstDayOffset(year, month) {
    const firstDay = new Date(year, month - 1, 1);
    let dow = firstDay.getDay();
    if (dow === 0) dow = 7;
    return dow - 1;
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

        if (!map[empId]) map[empId] = {};

        map[empId][day] = {
            start: item.start,
            end: item.end
        };
    });

    return map;
}