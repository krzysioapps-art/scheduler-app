const YEAR = 2026;
const MONTH = 3;

async function checkAuthAndRole(requiredRole) {
    const { data: { user } } = await client.auth.getUser();

    if (!user) {
        window.location.href = "/login.html";
        return null;
    }

    const { data } = await client
        .from("employees")
        .select("*")
        .eq("auth_user_id", user.id)
        .single();

    if (!data || data.role !== requiredRole) {
        window.location.href = "/manager/";
        return null;
    }

    return user;
}
(async () => {
    const user = await checkAuthAndRole("employee");
    if (!user) return;

    if (window.renderHeader) await window.renderHeader();

    await init(user);
})();
async function init(user) {
    const { data: employee, error } = await client
        .from("employees")
        .select("*")
        .eq("auth_user_id", user.id)
        .single();

    if (error || !employee) {
        alert("Brak pracownika");
        return;
    }

    document.getElementById("userInfo").innerText =
        `Zalogowany jako: ${employee.name || employee.id}`;

    loadSchedule(employee.id);
}

async function loadSchedule(employeeId) {
    const start = `${YEAR}-${String(MONTH).padStart(2, "0")}-01`;
    const end = new Date(YEAR, MONTH, 0).toISOString().split("T")[0];

    const { data, error } = await client
        .from("shifts")
        .select("*")
        .eq("employee_id", employeeId)
        .gte("date", start)
        .lte("date", end);

    if (error) {
        console.error(error);
        return;
    }

    render(data);
}

function render(shifts) {
    const daysRow = document.getElementById("daysRow");
    const scheduleRow = document.getElementById("scheduleRow");

    daysRow.innerHTML = "";
    scheduleRow.innerHTML = "";

    const days = new Date(YEAR, MONTH, 0).getDate();

    const map = {};
    shifts.forEach(s => {
        const d = new Date(s.date).getDate();
        map[d] = s;
    });

    for (let d = 1; d <= days; d++) {
        const th = document.createElement("th");
        th.innerText = d;
        daysRow.appendChild(th);

        const td = document.createElement("td");

        if (map[d]) {
            td.innerText = `${map[d].start} - ${map[d].end}`;
        } else {
            td.innerText = "-";
        }

        scheduleRow.appendChild(td);
    }
}

function goToPlan() {
    window.location.href = "/employee/plan/";
}