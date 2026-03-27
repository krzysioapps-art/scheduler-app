const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");
const info = document.getElementById("info");

const params = new URLSearchParams(window.location.search);
let code = params.get("code");

// 🔹 pobierz usera
async function getUser() {
    const { data } = await client.auth.getUser();
    return data.user;
}

// 🔹 pobierz aktywną sesję
async function getCurrentSession(userId) {
    const { data, error } = await client
        .from("work_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

    if (error) return null;

    return data;
}

// 🔹 pokaż START
function showStart() {
    startBtn.style.display = "block";
    endBtn.style.display = "none";
    info.innerText = "";
}

// 🔹 pokaż STOP
function showStop(session) {
    startBtn.style.display = "none";
    endBtn.style.display = "block";

    const start = new Date(session.start_time);
    info.innerText = `Pracujesz od: ${start.toLocaleTimeString()}`;
}

// 🔹 walidacja PIN
async function verifyToken(pin) {
    const { data, error } = await client
        .from("auth_tokens")
        .select("*")
        .eq("pin", pin)
        .gt("expires_at", new Date().toISOString())
        .single();

    if (error) return null;

    return data;
}

// 🔥 INIT
(async () => {
    const user = await getUser();

    // 🔐 jeśli brak usera → zapisz code i login
    if (!user) {
        if (code) {
            localStorage.setItem("scan_code", code);
        }
        window.location.href = "/login";
        return;
    }

    // 🔁 odzyskaj code po loginie
    const codeFromStorage = localStorage.getItem("scan_code");

    if (!code && codeFromStorage) {
        code = codeFromStorage;
    }

    // 🔥 jeśli wejście z QR
    if (code) {
        const token = await verifyCode(code);

        if (!token) {
            alert("Kod nieważny lub wygasł");
            return;
        }

        localStorage.removeItem("scan_code");

        await handleWorkAction(user.id, token);

        window.location.href = "/employee/worktime";
        return;
    }

    // 🔹 normalny tryb (PIN)
    const session = await getCurrentSession(user.id);

    if (!session) {
        showStart();
    } else {
        showStop(session);
    }

    startBtn.onclick = () => workWithPin(user.id);
    endBtn.onclick = () => workWithPin(user.id);
})();

async function handleWorkAction(userId, token) {
    const session = await getCurrentSession(userId);

    if (!session) {
        const { error } = await client.from("work_sessions").insert({
            user_id: userId,
            status: "active",
           // terminal_id: token.terminal_id
        });

        if (error) {
            alert("Błąd startu");
            return;
        }

        alert("Rozpoczęto pracę");
    } else {
        const { error } = await client
            .from("work_sessions")
            .update({
                status: "finished",
                end_time: new Date().toISOString(),
            })
            .eq("id", session.id);

        if (error) {
            alert("Błąd zakończenia");
            return;
        }

        alert("Zakończono pracę");
    }
}

async function workWithPin(userId) {
    const pin = prompt("Wpisz PIN");

    if (!pin || pin.length < 4) {
        alert("Podaj poprawny PIN");
        return;
    }

    const token = await verifyToken(pin);

    if (!token) {
        alert("Nieprawidłowy PIN");
        return;
    }

    await handleWorkAction(userId, token);

    location.reload();
}

async function verifyCode(code) {
    const { data, error } = await client
        .from("auth_tokens")
        .select("*")
        .eq("code", code)
        .gt("expires_at", new Date().toISOString())
        .single();

    if (error) return null;
    return data;
}