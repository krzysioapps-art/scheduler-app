const TERMINAL_ID = (() => {
    let id = localStorage.getItem("terminal_id");

    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("terminal_id", id);
    }

    return id;
})();
let countdownInterval = null;
console.log("QRCode global:", window.QRCode);

function generateToken() {
    const code = crypto.randomUUID();
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    return { code, pin, expires };
}

async function initTerminal() {
    const existing = await getCurrentToken();

    if (existing) {
        console.log("Używam istniejącego tokena");
        renderQR(existing.code);
        renderPIN(existing.pin);
        startCountdown(existing.expires_at);
    } else {
        console.log("Brak tokena – generuję pierwszy");
        await generateAndSaveToken(); // 🔥 wracamy do tego
    }
}

async function generateAndSaveToken() {
    console.log("START");

    const existing = await getCurrentToken();
    if (existing) {
        const expires = new Date(existing.expires_at).getTime();
        const nowMs = Date.now();

        if (expires - nowMs > 30_000) {
            renderQR(existing.code);
            renderPIN(existing.pin);
            startCountdown(existing.expires_at);
            return;
        }
    }

    const { code, pin, expires } = generateToken();

    const { error } = await client
        .from("auth_tokens")
        .upsert(
            {
                terminal_id: TERMINAL_ID,
                code,
                pin,
                expires_at: expires.toISOString(),
            },
            {
                onConflict: "terminal_id",
            }
        );

    if (error) {
        console.error("UPSERT ERROR:", error);
        return;
    }

    renderQR(code);
    renderPIN(pin);
    startCountdown(expires);
}

function renderQR(code) {
    const qrDiv = document.getElementById("qr");
    qrDiv.innerHTML = "";

    new QRCode(qrDiv, {
        text: `http://scheduler-app-mauve.vercel.app/employee/worktime?code=${code}`,
        width: 200,
        height: 200,
    });
}

function renderPIN(pin) {
    document.getElementById("pin").innerText = pin;
}

async function getCurrentToken() {
    const { data, error } = await client
        .from("auth_tokens")
        .select("*")
        .eq("terminal_id", TERMINAL_ID)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (error) {
        console.log("Brak aktywnego tokena");
        return null;
    }

    return data;
}

initTerminal();

function getDelayToNextInterval() {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

    const next = 5 - (minutes % 5);
    return (next * 60 - seconds) * 1000;
}

function startCountdown(expiresAt) {
    const el = document.getElementById("timer");

    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    const target = new Date(expiresAt);

    countdownInterval = setInterval(() => {
        const diff = target - new Date();

        if (diff <= 0) {
            clearInterval(countdownInterval);
            el.innerText = "Wygasł";
            return;
        }

        el.innerText = Math.floor(diff / 1000) + "s";
    }, 1000);
}

setTimeout(() => {
    generateAndSaveToken();
    setInterval(generateAndSaveToken, 5 * 60 * 1000);
}, getDelayToNextInterval());