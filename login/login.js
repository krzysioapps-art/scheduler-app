const client = window.client;
const DOMAIN = "local.pl";
const scanCode = localStorage.getItem("scan_code");

async function login() {
    const loginInput = document.getElementById("login");
    const passwordInput = document.getElementById("password");
    const errorEl = document.getElementById("error");
    const btn = document.getElementById("loginBtn");

    const login = loginInput.value.trim();
    const password = passwordInput.value;

    errorEl.innerText = "";

    if (!login || !password) {
        errorEl.innerText = "Uzupełnij dane";
        return;
    }

    const email = `${login}@${DOMAIN}`;

    btn.classList.add("loading");
    btn.innerText = "Logowanie...";

    const { data, error } = await client.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        errorEl.innerText = "Nieprawidłowe dane";
        btn.classList.remove("loading");
        btn.innerText = "Zaloguj";
        return;
    }

    const { data: emp } = await client
        .from("employees")
        .select("role")
        .eq("auth_user_id", data.user.id)
        .single();

    if (emp?.role === "manager") {
        window.location.href = "/manager/";
        return;
    }

    // 🔥 jeśli przyszedł z QR → wróć do worktime
    if (scanCode) {
        window.location.href = "/employee/worktime";
    } else {
        window.location.href = "/employee/";
    }
}